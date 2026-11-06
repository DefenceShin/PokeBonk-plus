using System.Threading;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace PokeBonk.Client;

// Independent sink: no gameplay, UI status writer, credentials or native run identifiers.
// batches.jsonl is the authoritative WAL. Acknowledgements follow Flush(true).
// events/samples/summary are repairable projections; a replay repairs them before ACK.
internal sealed class BattleRecordWriter(PortableStorage portable)
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly Dictionary<string, RunState> runs = new();
    private BattleReportPaths? reportPaths;
    private int queued;
    internal Action<string>? FailureProbe { get; set; }
    private sealed class RunState
    {
        public string Directory = "";
        public string ReportId = "";
        public readonly Dictionary<string, string> Committed = new();
        public readonly SummaryState Summary = new();
        public JsonObject? First;
        public long LastSeq;
        public bool ProjectionsDirty;
        public double LastSummaryGameSeconds = double.NegativeInfinity;
        public readonly List<string> Recovery = [];
    }
    internal async Task<JsonObject> AcceptAsync(JsonObject batch)
    {
        var ack = new JsonObject { ["runId"] = batch["runId"]?.DeepClone(),
            ["batchId"] = batch["batchId"]?.DeepClone(), ["lastSeq"] = batch["lastSeq"]?.DeepClone(), ["ok"] = false };
        if (Interlocked.Increment(ref queued) > 4) { Interlocked.Decrement(ref queued); ack["error"] = "writer-busy"; return ack; }
        try
        {
            // All disk and projection work stays off the dispatcher thread.
            return await Task.Run(async () => {
                await gate.WaitAsync();
                try {
                    var normalized=batch.DeepClone().AsObject();
                    var ticket=normalized["reportTicket"] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
                    normalized.Remove("reportTicket");
                    var suppliedReport = Id(normalized["reportId"]);
                    if (suppliedReport.Length > 0 && !Regex.IsMatch(suppliedReport, "^(run|observation)-[a-f0-9]{24}$"))
                        throw new InvalidOperationException("Invalid outbox report identity");
                    var derivedReport = BattleReportPaths.Id(ticket,Id(normalized["runId"]));
                    if (!string.IsNullOrEmpty(ticket) && suppliedReport.Length > 0 && suppliedReport != derivedReport)
                        throw new InvalidOperationException("Conflicting outbox report identity");
                    normalized["reportId"] = suppliedReport.Length > 0 ? suppliedReport : derivedReport;
                    Validate(normalized); lock(BattleReportPaths.Sync)Commit(normalized); ack["ok"] = true; return ack;
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException or ArgumentException)
                {
                    ack["error"] = ex is InvalidOperationException ? "invalid-or-conflicting-batch" : "record-write-failed";
                    return ack;
                }
                finally { gate.Release(); }
            });
        }
        finally { Interlocked.Decrement(ref queued); }
    }
    private static string Id(JsonNode? value) => value?.GetValue<string>() ?? "";
    private static long Seq(JsonNode? value) => long.TryParse(value?.ToJsonString(), out var number) ? number : -1;
    private static void Validate(JsonObject batch)
    {
        if (batch.ToJsonString().Length > 2 * 1024 * 1024 ||
            !Regex.IsMatch(Id(batch["runId"]), "^[a-zA-Z0-9_-]{1,160}$") ||
            !Regex.IsMatch(Id(batch["batchId"]), "^[a-zA-Z0-9_-]{1,180}$") ||
            batch["schemaVersion"]?.GetValue<int>() != 1 || batch["records"] is not JsonArray records || records.Count is < 1 or > 64)
            throw new InvalidOperationException("Invalid battle record batch");
        long prev = 0;
        foreach (var node in records)
        {
            if (node is not JsonObject record || Id(record["runId"]) != Id(batch["runId"]) || Seq(record["seq"]) <= prev ||
                Seq(record["segmentId"]) < 1 || record["schemaVersion"]?.GetValue<int>() != 1 ||
                !new[] { "event", "sample" }.Contains(Id(record["stream"])))
                throw new InvalidOperationException("Invalid record order/scope");
            prev = Seq(record["seq"]);
        }
        if (Seq(batch["firstSeq"]) != Seq(records[0]?["seq"]) || Seq(batch["lastSeq"]) != prev)
            throw new InvalidOperationException("Invalid batch bounds");
    }
    private string Safe(string path) => (reportPaths ??=new BattleReportPaths(portable)).Safe(path);
    private static string Hash(JsonObject batch) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(batch.ToJsonString())));
    private RunState Open(string runId,string reportId)
    {
        if (runs.TryGetValue(runId, out var known)) {
            if(known.ReportId!=reportId)throw new InvalidOperationException("Observation stream changed report identity");
            known.Directory=reportPaths!.Ensure(Path.Combine(reportPaths.Run(reportId),"streams",runId));
            return known;
        }
        // ID itself is unique per document/run; old folders are never reused for another run.
        reportPaths ??=new BattleReportPaths(portable);
        var state = new RunState { ReportId=reportId, Directory = reportPaths.Ensure(Path.Combine(reportPaths.Run(reportId),"streams",runId)) };
        var journal = Safe(Path.Combine(state.Directory, "batches.jsonl"));
        if (File.Exists(journal))
        {
            var bytes = File.ReadAllBytes(journal); int cursor = 0, valid = 0;
            while (cursor < bytes.Length)
            {
                var end = Array.IndexOf(bytes, (byte)'\n', cursor);
                if (end < 0) break;
                try
                {
                    var b = JsonNode.Parse(Encoding.UTF8.GetString(bytes, cursor, end - cursor))!.AsObject(); Validate(b);
                    if (Id(b["runId"]) != runId || state.Committed.ContainsKey(Id(b["batchId"])) || Seq(b["firstSeq"]) <= state.LastSeq) break;
                    state.Committed.Add(Id(b["batchId"]), Hash(b));
                    foreach (var record in b["records"]!.AsArray()) { state.First ??= record!.AsObject(); state.Summary.Add(record!.AsObject()); }
                    state.LastSeq = Seq(b["lastSeq"]); valid = end + 1; cursor = end + 1;
                }
                catch { break; }
            }
            if (valid != bytes.Length)
            {
                // Preserve exact original bytes before repairing an incomplete/corrupt tail.
                var backup = Safe(journal + ".damaged-" + Guid.NewGuid().ToString("N"));
                File.Copy(journal, backup, false);
                using var stream = new FileStream(journal, FileMode.Open, FileAccess.Write, FileShare.Read);
                stream.SetLength(valid); stream.Flush(true); state.Recovery.Add(Path.GetFileName(backup));
            }
            state.ProjectionsDirty = true;
        }
        runs.Add(runId, state); return state;
    }
    private void Commit(JsonObject batch)
    {
        var state = Open(Id(batch["runId"]),Id(batch["reportId"])); var id = Id(batch["batchId"]); var hash = Hash(batch);
        if (state.Committed.TryGetValue(id, out var prior))
        {
            if (prior != hash) throw new InvalidOperationException("Batch ID reused with different content");
            if (state.ProjectionsDirty) Rebuild(state);
            return;
        }
        if (Seq(batch["firstSeq"]) <= state.LastSeq) throw new InvalidOperationException("Overlapping/reordered batch");
        var journal = Safe(Path.Combine(state.Directory, "batches.jsonl"));
        using (var stream = new FileStream(journal, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.Read))
        {
            var start = stream.Length; stream.Position = start;
            try
            {
                FailureProbe?.Invoke("before-journal");
                var bytes = Encoding.UTF8.GetBytes(batch.ToJsonString() + "\n"); stream.Write(bytes);
                FailureProbe?.Invoke("before-flush"); stream.Flush(true);
            }
            catch { stream.SetLength(start); stream.Flush(true); throw; }
        }
        state.Committed.Add(id, hash); state.LastSeq = Seq(batch["lastSeq"]);
        var records = batch["records"]!.AsArray().Select(n => n!.AsObject()).ToList();
        foreach (var record in records) { state.First ??= record; state.Summary.Add(record); }
        var wasDirty = state.ProjectionsDirty; state.ProjectionsDirty = true;
        FailureProbe?.Invoke("after-journal");
        if (wasDirty) Rebuild(state);
        else
        {
            Append(state, "events.jsonl", records.Where(r => Id(r["stream"]) != "sample"));
            Append(state, "samples.jsonl", records.Where(r => Id(r["stream"]) == "sample"));
            var latestSeconds = records.LastOrDefault()?["gameSeconds"]?.GetValue<double>();
            var boundary = records.Any(r => Id(r["type"]) != "combat_summary" && Id(r["type"]) != "resource_delta");
            if (boundary || latestSeconds is null || latestSeconds - state.LastSummaryGameSeconds >= 10)
            { WriteSummary(state); state.LastSummaryGameSeconds = latestSeconds ?? double.NegativeInfinity; }
            state.ProjectionsDirty = false;
        }
        // At most the active and previous run retain projection state in memory.
        foreach (var key in runs.Keys.Where(k => k != Id(batch["runId"])).Take(Math.Max(0, runs.Count - 2)).ToList()) runs.Remove(key);
    }
    private void Append(RunState state, string name, IEnumerable<JsonObject> records)
    {
        var text = string.Concat(records.Select(r => r.ToJsonString() + "\n"));
        if (text.Length == 0) return;
        FailureProbe?.Invoke("projection");
        using var stream = new FileStream(Safe(Path.Combine(state.Directory, name)), FileMode.Append, FileAccess.Write, FileShare.Read);
        // WAL is already durable. Projection writes complete before ACK; recovery
        // always rebuilds them from WAL, so they need no second hardware flush.
        stream.Write(Encoding.UTF8.GetBytes(text)); stream.Flush();
    }
    private void Atomic(RunState state, string name, string content)
    {
        var destination = Safe(Path.Combine(state.Directory, name)); var temp = Safe(destination + ".tmp");
        using (var stream = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None))
        { stream.Write(Encoding.UTF8.GetBytes(content)); stream.Flush(true); }
        File.Move(temp, Safe(destination), true);
    }
    private void Rebuild(RunState state)
    {
        FailureProbe?.Invoke("projection");
        var eventPath = Safe(Path.Combine(state.Directory, "events.jsonl")); var samplePath = Safe(Path.Combine(state.Directory, "samples.jsonl"));
        using (var events = new StreamWriter(Safe(eventPath + ".tmp"), false, new UTF8Encoding(false)))
        using (var samples = new StreamWriter(Safe(samplePath + ".tmp"), false, new UTF8Encoding(false)))
        {
            foreach (var line in File.ReadLines(Safe(Path.Combine(state.Directory, "batches.jsonl"))))
                foreach (var record in JsonNode.Parse(line)!["records"]!.AsArray())
                    (Id(record?["stream"]) == "sample" ? samples : events).WriteLine(record!.ToJsonString());
            events.Flush(); samples.Flush(); ((FileStream)events.BaseStream).Flush(true); ((FileStream)samples.BaseStream).Flush(true);
        }
        File.Move(Safe(eventPath + ".tmp"), eventPath, true); File.Move(Safe(samplePath + ".tmp"), samplePath, true);
        WriteSummary(state); state.ProjectionsDirty = false;
    }
    internal static JsonObject Summarize(IEnumerable<JsonObject> records)
    {
        var summary = new SummaryState(); foreach (var record in records) summary.Add(record); return summary.Export();
    }
    private sealed class SummaryState
    {
        private readonly SortedDictionary<int, JsonObject> floors = new();
        private readonly Queue<JsonObject> markers = new();
        private readonly List<JsonObject> provenance = [];
        public JsonNode? SourceHash, ControllerRevision;
        private double total, unknown; private long previous; private int missing, count, markerCount;
        private string detail = "full";
        private int damageEvents, deaths, revives;
        private double goldGained, goldSpent;
        private JsonNode? lastBattle; private bool ended;
        public void Add(JsonObject r)
        {
            count++;
            var revision = r["controllerRevision"]?.ToJsonString(); var sourceHash = r["sourceHash"]?.ToJsonString();
            if (ControllerRevision?.ToJsonString() != revision || SourceHash?.ToJsonString() != sourceHash || provenance.Count == 0)
            {
                SourceHash = r["sourceHash"]?.DeepClone(); ControllerRevision = r["controllerRevision"]?.DeepClone();
                provenance.Add(new JsonObject { ["fromSeq"] = r["seq"]?.DeepClone(), ["segmentId"] = r["segmentId"]?.DeepClone(),
                    ["controllerRevision"] = ControllerRevision?.DeepClone(), ["sourceHash"] = SourceHash?.DeepClone() });
            }
            var seq = Seq(r["seq"]); if (previous > 0 && seq != previous + 1) missing++; previous = seq;
            var type = Id(r["type"]);
            if (type == "run_observed") detail = Id(r["capabilities"]?["recordingDetail"]) is "events" ? "events" : "full";
            if (type == "damage_taken") damageEvents++;
            if (type == "player_died") deaths++;
            if (type == "player_revived") revives++;
            if (type == "gold_changed") { goldGained += r["gainedObserved"]?.GetValue<double>() ?? 0; goldSpent += r["spentObserved"]?.GetValue<double>() ?? 0; }
            if (type is "integrity_gap" or "segment_start" or "observation_detached") { markerCount++; markers.Enqueue((JsonObject)r.DeepClone()); if (markers.Count > 128) markers.Dequeue(); }
            if (type == "run_ended") { ended = true; lastBattle = r["lastBattle"]?.DeepClone(); }
            else if ((type is "observation_detached" or "observation_end") && r["lastBattle"] is not null && !ended) lastBattle = r["lastBattle"]?.DeepClone();
            else if (type == "boundary" && !ended) lastBattle = r["current"]?.DeepClone();
            if (type != "combat_summary") return;
            var seconds = r["seconds"]?.GetValue<double>() ?? 0; total += seconds;
            var phase = Id(r["phase"]); if (phase == "unknown") unknown += seconds;
            var floor = r["intervalFloor"]?.GetValue<int>() ?? -1;
            if (!floors.TryGetValue(floor, out var f)) floors.Add(floor, f = new JsonObject { ["floor"] = floor < 0 ? null : floor,
                ["seconds"] = 0d, ["phases"] = new JsonObject(), ["killsObserved"] = 0d, ["damageTakenObserved"] = 0d,
                ["counterUnknownIntervals"] = 0, ["hpMinimumSampled"] = null });
            f["seconds"] = f["seconds"]!.GetValue<double>() + seconds;
            var phases = f["phases"]!.AsObject(); phases[phase] = (phases[phase]?.GetValue<double>() ?? 0) + seconds;
            foreach (var (input, output) in new[] { ("killsDelta", "killsObserved"), ("damageTakenDelta", "damageTakenObserved") })
                if (r[input] is not null) f[output] = f[output]!.GetValue<double>() + r[input]!.GetValue<double>();
                else f["counterUnknownIntervals"] = f["counterUnknownIntervals"]!.GetValue<int>() + 1;
            if (r["hpMinimumSampled"] is not null) f["hpMinimumSampled"] = Math.Min(f["hpMinimumSampled"]?.GetValue<double>() ?? double.MaxValue, r["hpMinimumSampled"]!.GetValue<double>());
        }
        public JsonObject Export() => new() { ["schemaVersion"] = 1, ["classifierVersion"] = 1,
            ["recordCount"] = count, ["lastSeq"] = previous, ["observedSeconds"] = total,
            ["unknownPhaseSeconds"] = unknown, ["sequenceGapCount"] = missing,
            ["integrityMarkers"] = new JsonArray(markers.Select(r => (JsonNode?)r.DeepClone()).ToArray()), ["integrityMarkerCount"] = markerCount,
            ["integrityMarkersTruncated"] = markerCount > markers.Count,
            ["provenance"] = new JsonArray(provenance.Select(p => p.DeepClone()).ToArray()),
            ["floors"] = new JsonArray(floors.Values.Select(f => f.DeepClone()).ToArray()),
            ["lastBattle"] = lastBattle?.DeepClone(),
            ["recordingDetail"] = detail, ["damageEvents"] = damageEvents, ["deathCount"] = deaths, ["reviveCount"] = revives,
            ["goldGainedObserved"] = goldGained, ["goldSpentObserved"] = goldSpent,
            ["ended"] = ended, ["completeness"] = detail == "events" ? "event-only; no-continuous-position-or-combat-samples; inspect-markers-and-observation-start" : "inspect-markers-and-observation-start; sampled-not-continuous",
            ["resourceAttribution"] = "unknown-unless-independent-native-proof", ["hpMinimumSemantics"] = "minimum-of-samples-only" };
    }
    private void WriteSummary(RunState state)
    {
        var summary = state.Summary.Export();
        summary["recoveryFiles"] = new JsonArray(state.Recovery.Select(s => (JsonNode?)JsonValue.Create(s)).ToArray());
        Atomic(state, "summary.json", summary.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        Atomic(state, "floors.jsonl", string.Concat(summary["floors"]!.AsArray().Select(f => f!.ToJsonString() + "\n")));
        var first = state.First;
        Atomic(state, "manifest.json", new JsonObject { ["schemaVersion"] = 1, ["runId"] = first?["runId"]?.DeepClone(),
            ["controllerRevision"] = state.Summary.ControllerRevision?.DeepClone(), ["sourceHash"] = state.Summary.SourceHash?.DeepClone(),
            ["initialSourceHash"] = first?["sourceHash"]?.DeepClone(),
            ["lastDurableSeq"] = state.LastSeq, ["canonical"] = "batches.jsonl", ["projectionRecovery"] = "rebuild-from-committed-batches",
            ["summaryCheckpointMaxGameSeconds"] = 10, ["checkpointSeq"] = state.LastSeq,
            ["nativeIdentityPersisted"] = false, ["durability"] = "FileStream.Flush(true); filesystem/hardware guarantees apply" }.ToJsonString());
    }
}
