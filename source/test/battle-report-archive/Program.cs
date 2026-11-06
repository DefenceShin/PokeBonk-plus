using PokeBonk.Client;
using System.Text.Json.Nodes;

var root=Path.GetFullPath(Path.Combine(args.FirstOrDefault()??"artifacts/report-tests",Guid.NewGuid().ToString("N")));
var store=new PortableStorage(root);var archive=new BattleReportArchive(store);var passed=0;
void Check(bool ok,string why){if(!ok)throw new Exception(why);}
void Pass(string why){passed++;Console.WriteLine("PASS "+why);}
JsonObject Game(double seconds=10,int floor=1) => new() {
    ["state"]="play",["nativeMode"]="tower",["time"]=seconds,["hp"]=100,["maxHp"]=100,["level"]=10,
    ["controllerVersion"]="test-revision",["tower"]=new JsonObject{["floor"]=floor,["wave"]=0},
    ["combat"]=new JsonObject{["items"]=new JsonArray(new JsonArray("muscle-band",1))},
    ["profile"]=new JsonObject{["privateFixture"]="must-not-be-exported"},["accountId"]="must-not-be-exported",["events"]=new JsonArray()};
const string ticket="fixture-native-ticket";
var id=BattleReportPaths.Fingerprint(ticket);var dir=Path.Combine(root,"battle-reports",id);
File.WriteAllText(store.SettingsPath,"{\"mode\":\"tower\"}");File.WriteAllText(store.DataPath("custom-plans.json"),"{\"plans\":[]}");
await archive.ObserveAsync(Game(),ticket,"1000");
Check(archive.Error is null,"initial write: "+archive.Error);
Check(File.Exists(Path.Combine(dir,"last-snapshot.json")),"snapshot exists");
Check(File.Exists(Path.Combine(dir,"initial-config","settings.json")),"config exists");
Check(!File.ReadAllText(Path.Combine(dir,"last-snapshot.json")).Contains("must-not-be-exported"),"private profile removed");
Pass("one game snapshot/config with account and profile omitted");
await archive.ObserveAsync(Game(11),ticket,"1000");Check(File.ReadAllLines(Path.Combine(dir,"timeline.jsonl")).Length==1,"not every host tick");
await archive.ObserveAsync(Game(12,2),ticket,"1000");Check(File.ReadAllLines(Path.Combine(dir,"timeline.jsonl")).Length==2,"floor boundary saved");
Pass("ten-game-second budget and immediate floor boundary");
var end=new JsonObject{["id"]=ticket,["kind"]="settlement",["runAt"]=1000,["saved"]=true,["time"]=90,["endHow"]="quit",["towerFloor"]=3,["towerClearedFloor"]=2};
await archive.ObserveAsync(new JsonObject{["events"]=new JsonArray(end)},null,null);
Check(archive.Error is null,"settlement write");
Check(JsonNode.Parse(File.ReadAllText(Path.Combine(dir,"report-manifest.json")))!["completed"]!.GetValue<bool>(),"marked saved");
Check(JsonNode.Parse(File.ReadAllText(Path.Combine(dir,"last-snapshot.json")))!["combat"] is not null,"equipment survived detached state");
Check(File.ReadAllText(Path.Combine(dir,"summary.txt")).Contains("quit"),"quit is not a victory");
var contents=string.Join("\n",Directory.GetFiles(dir,"*",SearchOption.AllDirectories).Select(File.ReadAllText));
Check(!contents.Contains(ticket),"original native ticket not persisted");
Pass("settlement shares folder without erasing last combat or persisting ticket");
await new BattleReportArchive(store).ObserveAsync(Game(30,2),ticket,"2000");
Check(Directory.GetDirectories(Path.Combine(root,"battle-reports")).Length==1,"same ticket across reload/host remains one folder");
await archive.ObserveAsync(Game(0),"another-ticket","3000");
Check(Directory.GetDirectories(Path.Combine(root,"battle-reports")).Length==2,"next run separate");
Pass("restart and next-run boundaries");
var childStore=new PortableStorage(Path.Combine(root,"next-version"));
await new BattleReportArchive(childStore).ObserveAsync(Game(31,3),ticket,"4000");
Check(new BattleReportPaths(childStore).Root==Path.Combine(childStore.RootDirectory,"battle-reports"),"version owns its report folder even if parent has reports");
Check(File.Exists(Path.Combine(childStore.RootDirectory,"battle-reports",id,"last-snapshot.json")),"child report written in child version");
var isolated=new PortableStorage(Path.Combine(root,"test-version"),"smoke");
Check(new BattleReportPaths(isolated).Root==Path.Combine(isolated.DataDirectory,"battle-reports"),"test profiles isolated");
Pass("each executable owns its reports; parent version and smoke profiles isolated");
var writer=new BattleRecordWriter(childStore);
JsonObject Batch(string observation,string t)=>new(){["schemaVersion"]=1,["runId"]=observation,["reportTicket"]=t,["batchId"]=observation+"-1",["firstSeq"]=1,["lastSeq"]=1,
    ["records"]=new JsonArray(new JsonObject{["schemaVersion"]=1,["runId"]=observation,["segmentId"]=1,["seq"]=1,["stream"]="event",["type"]="run_observed"})};
Check((await writer.AcceptAsync(Batch("stream-a",ticket)))["ok"]!.GetValue<bool>(),"stream a accepted");
Check((await writer.AcceptAsync(Batch("stream-b",ticket)))["ok"]!.GetValue<bool>(),"stream b accepted");
var childDir=Path.Combine(childStore.RootDirectory,"battle-reports",id);
Check(Directory.GetDirectories(Path.Combine(childDir,"streams")).Length==2,"two observations share game folder in the same executable");
Check(!string.Join("\n",Directory.GetFiles(Path.Combine(childDir,"streams"),"*",SearchOption.AllDirectories).Select(File.ReadAllText)).Contains(ticket),"raw ticket never reaches WAL");
Check(!(await writer.AcceptAsync(Batch("stream-a","different-ticket")))["ok"]!.GetValue<bool>(),"changed identity rejected");
Pass("detailed WAL goes under same game with separate replay-safe streams");
var reportPaths=new BattleReportPaths(store);
try{reportPaths.Safe(Path.Combine(root,"escape.json"));throw new Exception("escape accepted");}catch(IOException){}
var linked=Path.Combine(root,"linked-client");Directory.CreateDirectory(linked);
var outside=Path.Combine(root,"outside");Directory.CreateDirectory(outside);
var linkPath=Path.Combine(linked,"battle-reports");
if(OperatingSystem.IsWindows()) {
    var start=new System.Diagnostics.ProcessStartInfo("powershell.exe"){UseShellExecute=false,CreateNoWindow=true};
    start.ArgumentList.Add("-NoProfile");start.ArgumentList.Add("-Command");
    start.ArgumentList.Add("New-Item -ItemType Junction -Path '"+linkPath.Replace("'","''")+"' -Target '"+outside.Replace("'","''")+"' | Out-Null");
    using var process=System.Diagnostics.Process.Start(start)!;process.WaitForExit();Check(process.ExitCode==0,"create test junction");
} else Directory.CreateSymbolicLink(linkPath,outside);
try{new BattleReportPaths(new PortableStorage(linked));throw new Exception("link accepted");}catch(IOException){}
Directory.Delete(linkPath,false);
Pass("report writes reject traversal and linked roots");
var failedStore=new PortableStorage(Path.Combine(root,"failure"));Directory.CreateDirectory(Path.Combine(failedStore.RootDirectory,"battle-reports"));
File.WriteAllText(Path.Combine(failedStore.RootDirectory,"battle-reports","project.json"),"{\"kind\":\"pokebonk-battle-reports\",\"schemaVersion\":1}");
var failedDir=Path.Combine(failedStore.RootDirectory,"battle-reports",id);File.WriteAllText(failedDir,"blocked by file");
var failed=new BattleReportArchive(failedStore);await failed.ObserveAsync(Game(),ticket,"1000");
Check(failed.Error is not null,"write failure surfaced without throwing into game loop");
File.Delete(failedDir);await failed.ObserveAsync(Game(),ticket,"1000");Check(failed.Error is null,"retry recovers");
Pass("archive failure is visible and retryable without changing gameplay");
Console.WriteLine($"{passed}/{passed} archive tests passed; isolated output: {root}");

// Naming is tested against real archive/WAL files, including writes after rename.
var namedStore=new PortableStorage(Path.Combine(root,"named"));
var namedArchive=new BattleReportArchive(namedStore);var namedWriter=new BattleRecordWriter(namedStore);
const string namedTicket="name-fixture";
var nameId=BattleReportPaths.Fingerprint(namedTicket);
var endedAt=DateTimeOffset.Parse("2026-10-26T16:42:16Z").ToUnixTimeMilliseconds();
JsonObject NamedEnd(string t=namedTicket)=>new(){["kind"]="settlement",["id"]=t,["runAt"]=1234,["saved"]=true,
    ["at"]=endedAt+90000,["endedAt"]=endedAt,["species"]=92,["reportSpecies"]=94,["time"]=90,["endHow"]="quit"};
await namedArchive.ObserveAsync(Game(),namedTicket,"1234");
Check((await namedWriter.AcceptAsync(Batch("named-stream",namedTicket)))["ok"]!.GetValue<bool>(),"initial named stream");
await namedArchive.ObserveAsync(new JsonObject{["events"]=new JsonArray(NamedEnd())},null,null);
var namedDir=Path.Combine(namedStore.RootDirectory,"battle-reports","Gengar_2026-10-27_00-42-16");
Check(namedArchive.Error is null,"naming error: "+namedArchive.Error);
Check(Directory.Exists(namedDir),"English final species + actual end time (UTC+08), not save receipt time");
Check(File.Exists(Path.Combine(namedDir,"Gengar_2026-10-27_00-42-16.txt")),"readable report matches folder name");
Check(!Directory.Exists(Path.Combine(namedStore.RootDirectory,"battle-reports",nameId)),"hashed working directory finalized");
Check(File.Exists(Path.Combine(namedDir,"streams","named-stream","batches.jsonl")),"earlier WAL moved intact");
var late=Batch("named-stream",namedTicket);late["batchId"]="named-stream-2";late["firstSeq"]=2;late["lastSeq"]=2;late["records"]![0]!["seq"]=2;
Check((await namedWriter.AcceptAsync(late))["ok"]!.GetValue<bool>(),"cached writer accepts delayed batch after rename");
Check(File.ReadAllLines(Path.Combine(namedDir,"streams","named-stream","batches.jsonl")).Length==2,"delayed batch stays in same renamed folder");
((System.Collections.IDictionary)typeof(BattleReportPaths).GetField("Resolved",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Static)!.GetValue(null)!).Clear();
Check((await new BattleRecordWriter(namedStore).AcceptAsync(late))["ok"]!.GetValue<bool>(),"restart replays against renamed WAL");
await new BattleReportArchive(namedStore).ObserveAsync(new JsonObject{["events"]=new JsonArray(NamedEnd())},null,null);
Check(Directory.GetDirectories(Path.Combine(namedStore.RootDirectory,"battle-reports")).Length==1,"receipt replay does not duplicate report");
Pass("English naming uses final species/end instant and survives late WAL plus restart replay");
var second=NamedEnd("second-name-fixture");second["runAt"]=5678;
await namedArchive.ObserveAsync(new JsonObject{["events"]=new JsonArray(second)},null,null);
Check(Directory.Exists(namedDir+"-2"),"same-second collision gets suffix without overwriting prior game");
Check(File.ReadAllLines(Path.Combine(namedDir,"streams","named-stream","batches.jsonl")).Length==2,"collision preserves original records");
Pass("same name and end second preserve both games");
var weird=NamedEnd("missing-name-fixture");weird["reportSpecies"]=999999;weird["runAt"]=7000;
await namedArchive.ObserveAsync(new JsonObject{["events"]=new JsonArray(weird)},null,null);
Check(Directory.Exists(Path.Combine(namedStore.RootDirectory,"battle-reports","Pokemon-999999_2026-10-27_00-42-16")),"unknown species stays explicit and filesystem safe");
var failedNameStore=new PortableStorage(Path.Combine(root,"rename-failure"));var failedNameArchive=new BattleReportArchive(failedNameStore);
await failedNameArchive.ObserveAsync(Game(),namedTicket,"1234");
var heldFile=Path.Combine(failedNameStore.RootDirectory,"battle-reports",nameId,"last-snapshot.json");
if(OperatingSystem.IsWindows()) {
 using(var held=new FileStream(heldFile,FileMode.Open,FileAccess.Read,FileShare.Read)) {
  await failedNameArchive.ObserveAsync(new JsonObject{["events"]=new JsonArray(NamedEnd())},null,null);
  Check(failedNameArchive.Error is not null,"locked file rename surfaces failure");
 }
 await failedNameArchive.ObserveAsync(new JsonObject{["events"]=new JsonArray(NamedEnd())},null,null);
 Check(failedNameArchive.Error is null,"rename retries after transient file lock");
 Check(Directory.Exists(Path.Combine(failedNameStore.RootDirectory,"battle-reports","Gengar_2026-10-27_00-42-16")),"retry preserves requested name");
}
Pass("unknown species and failed rename remain safe and retryable");
Console.WriteLine($"{passed}/{passed} archive and naming tests passed");
