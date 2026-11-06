using System.Text.Json.Nodes;
using System.Text.Json;
using PokeBonk.Client;
using System.Diagnostics;

var output = Path.GetFullPath(args.FirstOrDefault() ?? "validation/storage-test");
Directory.CreateDirectory(output);
var root = Path.Combine(output, "isolated-" + Guid.NewGuid().ToString("N"));
var store = new PortableStorage(root); var writer = new BattleRecordWriter(store); int passed = 0;
void Require(bool ok, string message) { if (!ok) throw new Exception(message); }
void Pass(string name) { Console.WriteLine("PASS " + name); passed++; }
JsonObject Batch(string id, int first, string run = "test-run", string type = "combat_summary") => new() {
    ["schemaVersion"] = 1, ["runId"] = run, ["batchId"] = id, ["firstSeq"] = first, ["lastSeq"] = first,
    ["records"] = new JsonArray(new JsonObject { ["schemaVersion"] = 1, ["runId"] = run, ["segmentId"] = 1,
        ["seq"] = first, ["stream"] = type == "combat_summary" ? "sample" : "event", ["type"] = type,
        ["phase"] = "wave-active", ["seconds"] = 1d, ["intervalFloor"] = 1,
        ["killsDelta"] = 2d, ["damageTakenDelta"] = null, ["hpMinimumSampled"] = 90d }) };
async Task<bool> Accept(JsonObject b) => (await writer.AcceptAsync(b))["ok"]?.GetValue<bool>() == true;
var b1 = Batch("b1", 1);
Require(await Accept(b1), "initial batch"); Require(await Accept(b1), "duplicate ACK");
var dir = Path.Combine(new BattleReportPaths(store).Run(BattleReportPaths.Id(null,"test-run")),"streams","test-run");
Require(File.ReadAllLines(Path.Combine(dir, "batches.jsonl")).Length == 1, "duplicate canonical write");
Require(File.ReadAllLines(Path.Combine(dir, "samples.jsonl")).Length == 1, "duplicate sample projection"); Pass("duplicate batch idempotent");
Require(!await Accept(Batch("b1", 2)), "conflicting batch rejected");
Require(!await Accept(Batch("overlap", 1)), "overlapping sequence rejected"); Pass("conflicts and reordering rejected");
writer.FailureProbe = phase => { if (phase == "before-flush") throw new IOException("injected disk-full"); };
Require(!await Accept(Batch("b2", 2)), "failed flush cannot ACK");
Require(File.ReadAllLines(Path.Combine(dir, "batches.jsonl")).Length == 1, "rollback uncommitted tail");
writer.FailureProbe = null; Require(await Accept(Batch("b2", 2)), "retry after disk failure"); Pass("disk failure no ACK and retry commits once");
writer.FailureProbe = phase => { if (phase == "after-journal") throw new IOException("injected projection crash"); };
Require(!await Accept(Batch("b3", 3)), "projection failure no ACK");
writer.FailureProbe = null; Require(await Accept(Batch("b3", 3)), "replay rebuilds projections");
Require(File.ReadAllLines(Path.Combine(dir, "samples.jsonl")).Length == 3, "projection exact after replay"); Pass("commit before disconnect replay deduplicates and repairs");
writer = new BattleRecordWriter(store); Require(await Accept(Batch("b3", 3)), "restart replay ACK");
Require(File.ReadAllLines(Path.Combine(dir, "samples.jsonl")).Length == 3, "restart no duplicates"); Pass("restart resumes durable dedup index");
File.AppendAllText(Path.Combine(dir, "batches.jsonl"), "{incomplete-tail");
writer = new BattleRecordWriter(store); Require(await Accept(Batch("b4", 4)), "recover tail");
Require(Directory.GetFiles(dir, "*.damaged-*").Length == 1, "preserve original damaged journal");
Require(File.ReadAllLines(Path.Combine(dir, "batches.jsonl")).Length == 4, "recover valid boundary"); Pass("corrupt tail preserved with explicit recovery boundary");
Require(!await Accept(Batch("bad", 5, "../escape")), "reject traversal"); Pass("path containment rejected");
var end = Batch("end", 5, type:"run_ended"); end["records"]![0]!["lastBattle"] = new JsonObject { ["hp"] = 73d, ["loadout"] = new JsonObject { ["moves"] = new JsonArray("fusion") } };
Require(await Accept(end), "end commit"); Require(await Accept(Batch("empty", 6, type:"observation_detached")), "empty-state commit");
var summary = JsonNode.Parse(File.ReadAllText(Path.Combine(dir, "summary.json")))!;
Require(summary["lastBattle"]?["hp"]?.GetValue<double>() == 73, "last battle preserved");
Require(summary["observedSeconds"]!.GetValue<double>() == 4, "sample time reconciliation"); Pass("settlement snapshot survives empty observation");
var hashed = Batch("hashed-1", 1, "outbox-recovered", "player_died");
var hashedId = BattleReportPaths.Fingerprint("transport-only-ticket"); hashed["reportId"] = hashedId;
Require(await Accept(hashed), "hashed outbox identity accepted");
Require(File.Exists(Path.Combine(output, Path.GetRelativePath(output, root), "battle-reports", hashedId, "streams", "outbox-recovered", "batches.jsonl")), "outbox writes into original report folder");
var invalidReport = Batch("bad-hash", 1, "invalid-hash"); invalidReport["reportId"] = "../escape";
Require(!await Accept(invalidReport), "malformed prehashed report rejected");
Pass("recovered outbox routes by hash without a persisted native ticket");
var eventSummary = BattleRecordWriter.Summarize(new[] {
    new JsonObject { ["seq"]=1, ["type"]="run_observed", ["capabilities"]=new JsonObject { ["recordingDetail"]="events" } },
    new JsonObject { ["seq"]=2, ["type"]="damage_taken", ["hpLost"]=8d, ["damageDelta"]=10d },
    new JsonObject { ["seq"]=3, ["type"]="player_died" },
    new JsonObject { ["seq"]=4, ["type"]="player_revived" },
    new JsonObject { ["seq"]=5, ["type"]="gold_changed", ["delta"]=7d, ["gainedObserved"]=12d, ["spentObserved"]=5d }
});
Require(eventSummary["recordingDetail"]?.GetValue<string>() == "events", "event-only coverage labeled");
Require(eventSummary["damageEvents"]?.GetValue<int>() == 1 && eventSummary["deathCount"]?.GetValue<int>() == 1 && eventSummary["reviveCount"]?.GetValue<int>() == 1, "critical health events summarized");
Require(eventSummary["goldGainedObserved"]?.GetValue<double>() == 12 && eventSummary["goldSpentObserved"]?.GetValue<double>() == 5, "gold income and spending retained");
Pass("event-only summary reports health and currency without fabricating continuous sampling");
if (args.Length > 1) {
    var input = args[1]; var times = new List<double>(); var checkpoints = new JsonArray(); long batches = 0;
    foreach (var line in File.ReadLines(input)) { var b = JsonNode.Parse(line)!.AsObject(); var sw = Stopwatch.StartNew(); Require(await Accept(b), "simulation batch write"); times.Add(sw.Elapsed.TotalMilliseconds); batches++;
        if (batches % 1000 == 0) checkpoints.Add(new JsonObject { ["batches"] = batches, ["lastWindowP95Ms"] = times.TakeLast(1000).Order().ElementAt(950), ["managedBytes"] = GC.GetTotalMemory(false), ["workingSetBytes"] = Process.GetCurrentProcess().WorkingSet64 }); }
    var windowP95Index = (int)((Math.Min(1000, times.Count) - 1) * .95);
    var firstP95 = times.Take(1000).Order().ElementAt(windowP95Index); var lastP95 = times.TakeLast(1000).Order().ElementAt(windowP95Index); times.Sort(); var report = new JsonObject { ["checkpoints"] = checkpoints, ["first1000P95Ms"] = firstP95, ["last1000P95Ms"] = lastP95, ["batches"] = batches, ["writeMedianMs"] = times[times.Count/2], ["writeP95Ms"] = times[(int)(times.Count*.95)], ["writeMaxMs"] = times[^1], ["totalWriteMs"] = times.Sum(), ["output"] = root, ["isLiveGame"] = false };
    File.WriteAllText(Path.Combine(output, "writer-performance.json"), report.ToJsonString(new JsonSerializerOptions { WriteIndented=true }));
    Console.WriteLine(report.ToJsonString());
}
Console.WriteLine($"{passed}/{passed} storage tests passed; isolated output: {root}");
