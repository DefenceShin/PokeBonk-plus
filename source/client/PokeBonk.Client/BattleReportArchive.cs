using System.Threading;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace PokeBonk.Client;

// Each executable owns its battle-reports directory. Test profiles are isolated
// under their profile data directory; a neighbouring version is never selected.
internal sealed class BattleReportPaths
{
    // Both sinks share this gate so finalization cannot move an open WAL.
    internal static readonly object Sync = new();
    private static readonly Dictionary<string,string> Resolved = new();
    internal string Root { get; }
    private static readonly StringComparison Comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
    internal BattleReportPaths(PortableStorage storage)
    {
        var app=storage.RootDirectory;
        var isolated=!Path.TrimEndingDirectorySeparator(storage.DataDirectory).Equals(Path.Combine(app,"data"),Comparison);
        var local=Path.Combine(app,"battle-reports");
        Root=isolated ? Path.Combine(storage.DataDirectory,"battle-reports") : local;
        CheckLinks(Root);
    }
    private static void CheckLinks(string full)
    {
        full=Path.GetFullPath(full);
        var volume=Path.GetPathRoot(full)!; var remaining=full[volume.Length..];
        if(OperatingSystem.IsWindows()&&remaining.Contains(':'))throw new IOException("Report alternate stream rejected");
        var current=volume;
        foreach(var part in remaining.Split(new[]{Path.DirectorySeparatorChar,Path.AltDirectorySeparatorChar},StringSplitOptions.RemoveEmptyEntries).Prepend("")) {
            if(part.Length>0)current=Path.Combine(current,part);
            FileAttributes attributes;
            try {attributes=File.GetAttributes(current);}catch(FileNotFoundException){break;}catch(DirectoryNotFoundException){break;}
            if((attributes&FileAttributes.ReparsePoint)!=0)throw new IOException("Report link rejected");
        }
    }
    internal string Safe(string path)
    {
        var full=Path.GetFullPath(path);var prefix=Path.TrimEndingDirectorySeparator(Root)+Path.DirectorySeparatorChar;
        if(!full.Equals(Root,Comparison)&&!full.StartsWith(prefix,Comparison))throw new IOException("Report path escapes report root");
        CheckLinks(full);return full;
    }
    internal string Ensure(string path) {path=Safe(path);Directory.CreateDirectory(path);return Safe(path);}
    internal static string Fingerprint(string ticket) => "run-"+Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("pokebonk-report:"+ticket))).ToLowerInvariant()[..24];
    internal static string Id(string? ticket,string fallback)
    {
        if(!string.IsNullOrEmpty(ticket)&&ticket.Length<=256)return Fingerprint(ticket);
        return "observation-"+Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(fallback))).ToLowerInvariant()[..24];
    }
    internal string Run(string id)
    {
        lock(Sync) return ResolveRun(id);
    }
    private string ResolveRun(string id)
    {
        if(!Regex.IsMatch(id,"^(run|observation)-[a-f0-9]{24}$"))throw new IOException("Invalid report ID");
        Ensure(Root);
        var marker=Safe(Path.Combine(Root,"project.json"));
        if(!File.Exists(marker))Atomic(marker,new JsonObject{["kind"]="pokebonk-battle-reports",["schemaVersion"]=1}.ToJsonString());
        var key=Root+"|"+id;
        if(Resolved.TryGetValue(key,out var known)&&Directory.Exists(Safe(known)))return known;
        var working=Safe(Path.Combine(Root,id));
        if(!Directory.Exists(working))foreach(var folder in Directory.EnumerateDirectories(Root)) {
            var manifest=Safe(Path.Combine(folder,"report-manifest.json"));
            if(!File.Exists(manifest))continue;
            try {
                if(JsonNode.Parse(File.ReadAllText(manifest))?["reportId"]?.ToString()==id) {
                    working=Safe(folder);break;
                }
            } catch(JsonException) { /* Keep damaged unrelated reports intact. */ }
        }
        if(Resolved.Count>=1024)Resolved.Clear();
        return Resolved[key]=Ensure(working);
    }
    internal string FinalizeRun(string id,string stem)
    {
        lock(Sync) {
            if(!Regex.IsMatch(stem,@"^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$"))throw new IOException("Invalid report name");
            var current=ResolveRun(id);
            if(Path.GetFileName(current)!=id)return current;
            var destination=Safe(Path.Combine(Root,stem));var suffix=2;
            while(Directory.Exists(destination)||File.Exists(destination))destination=Safe(Path.Combine(Root,stem+"-"+suffix++));
            // Both absolute paths have been checked against this report root.
            Directory.Move(Safe(current),Safe(destination));
            Resolved[Root+"|"+id]=destination;return destination;
        }
    }
    internal void Atomic(string destination,string text)
    {
        destination=Safe(destination);Ensure(Path.GetDirectoryName(destination)!);
        var temp=Safe(destination+".tmp-"+Guid.NewGuid().ToString("N"));
        try {
            using(var stream=new FileStream(temp,FileMode.CreateNew,FileAccess.Write,FileShare.None)) {
                var bytes=Encoding.UTF8.GetBytes(text);stream.Write(bytes);stream.Flush(true);
            }
            File.Move(Safe(temp),Safe(destination),true);
        } finally {if(File.Exists(temp))File.Delete(Safe(temp));}
    }
}

// Host-only snapshots also support the retained old controller. No decisions,
// gameplay calls or settings changes. All report I/O is off the UI dispatcher.
internal sealed class BattleReportArchive(PortableStorage storage)
{
    private readonly SemaphoreSlim gate=new(1,1);
    private BattleReportPaths? paths;
    private readonly string session=Guid.NewGuid().ToString("N");
    private readonly Dictionary<string,string> byRunAt=new();
    private readonly Dictionary<string,(double Seconds,string Boundary)> checkpoints=new();
    private readonly HashSet<string> savedSettlements=new();
    internal string? Error {get;private set;}
    private static string Text(JsonNode? n)=>n?.ToString()??"";
    private static double? Number(JsonNode? n)=>n is JsonValue&&double.TryParse(n.ToJsonString(),
        System.Globalization.NumberStyles.Float,System.Globalization.CultureInfo.InvariantCulture,out var d)&&double.IsFinite(d)?d:null;
    private static readonly Lazy<Dictionary<int,string>> EnglishNames=new(()=>{
        using var stream=typeof(BattleReportArchive).Assembly.GetManifestResourceStream("payload.encyclopedia.json");
        var names=new Dictionary<int,string>();if(stream is null)return names;
        var entries=JsonNode.Parse(stream)?["entries"] as JsonArray ?? [];
        foreach(var row in entries.OfType<JsonObject>()) {
            if(Text(row["category"])!="pokemon"||!int.TryParse(Text(row["details"]?["编号"]),out var id))continue;
            var key=Text(row["details"]?["key"]);
            if(Regex.IsMatch(key,"^[a-z0-9]+(?:-[a-z0-9]+)*$"))
                names[id]=string.Join("-",key.Split('-').Select(part=>char.ToUpperInvariant(part[0])+part[1..]));
        }
        return names;
    });
    private static string? CompletedName(JsonObject end,JsonObject? last)
    {
        var milliseconds=Number(end["endedAt"])??Number(end["at"]);
        if(milliseconds is null || milliseconds<0 || milliseconds>253402271999999)return null;
        var species=Number(end["reportSpecies"])??Number(last?["plan"]?["currentLoadout"]?["species"])??
            Number(last?["currentLoadout"]?["species"])??Number(end["species"]);
        var name=species is >0 and <=int.MaxValue ? EnglishNames.Value.GetValueOrDefault((int)species.Value) : null;
        name ??=species is >0 and <=int.MaxValue?"Pokemon-"+((int)species.Value).ToString(System.Globalization.CultureInfo.InvariantCulture):"Unknown-Pokemon";
        var ended=DateTimeOffset.FromUnixTimeMilliseconds((long)milliseconds.Value).ToOffset(TimeSpan.FromHours(8));
        return name+"_"+ended.ToString("yyyy-MM-dd_HH-mm-ss",System.Globalization.CultureInfo.InvariantCulture);
    }
    private static readonly string[] SnapshotFields=["state","nativeMode","biome","tier","stage","level","hp","maxHp","time","kills","damageTaken","tower","combat","currentLoadout","choiceTrace","recentChoiceTrace","plan","controllerVersion","compatibility"];
    private static JsonObject Select(JsonObject input,IEnumerable<string> fields) {
        var result=new JsonObject();foreach(var key in fields)if(input[key] is {} value)result[key]=value.DeepClone();return result;
    }
    internal async Task ObserveAsync(JsonObject? game,string? ticket,string? runAt)
    {
        if(game is null)return;
        var snapshot=Select(game,SnapshotFields);
        var ends=(game["events"] as JsonArray ?? []).OfType<JsonObject>().Where(x=>Text(x["kind"])=="settlement")
            .Select(x=>Select(x,["id","runAt","at","endedAt","reportSpecies","saved","time","kills","victory","nativeMode","biome","tier","species","endHow","playerDead","cooperative","towerFloor","towerClearedFloor","towerWon","towerRoof","towerBeyond","error"])).ToArray();
        await gate.WaitAsync();
        try {await Task.Run(()=>{lock(BattleReportPaths.Sync)Observe(snapshot,ends,ticket,runAt);});Error=null;}
        catch(Exception ex) when(ex is IOException or UnauthorizedAccessException or JsonException or ArgumentException or InvalidOperationException or System.Security.SecurityException) {Error="battle-report-write-failed: "+ex.Message;}
        finally {gate.Release();}
    }
    private void Observe(JsonObject snapshot,JsonObject[] settlements,string? ticket,string? runAt)
    {
        paths ??=new BattleReportPaths(storage);
        var live=Number(snapshot["time"]) is not null && Text(snapshot["state"]) is "play" or "paused" or "modal" or "over";
        if(live) {
            var fallback=session+":"+runAt;var id=BattleReportPaths.Id(ticket,fallback);
            if(!string.IsNullOrEmpty(runAt))byRunAt[runAt]=id;
            var seconds=Number(snapshot["time"])!.Value;
            var boundary=Text(snapshot["state"])+":"+snapshot["tower"]?["floor"]+":"+snapshot["tower"]?["wave"];
            if(!checkpoints.TryGetValue(id,out var previous)||seconds<previous.Seconds||seconds-previous.Seconds>=10||boundary!=previous.Boundary) {
                var dir=paths.Run(id);var last=paths.Safe(Path.Combine(dir,"last-snapshot.json"));
                var manifest=Read(dir,"report-manifest.json") ?? new JsonObject{["schemaVersion"]=1,["reportId"]=id,["firstObservedAt"]=DateTimeOffset.Now.ToString("O"),
                    ["identitySource"]=string.IsNullOrEmpty(ticket)?"observation-only-continuation-unknown":"native-ticket-sha256-prefix",
                    ["firstObservedGameSeconds"]=seconds,["completed"]=false};
                var versions=manifest["controllerVersions"] as JsonArray ?? new JsonArray();
                var version=Text(snapshot["controllerVersion"]);
                if(!versions.Any(x=>Text(x)==version))versions.Add(version);manifest["controllerVersions"]=versions.Parent is null?versions:versions.DeepClone();
                manifest["lastObservedAt"]=DateTimeOffset.Now.ToString("O");manifest["lastGameSeconds"]=seconds;
                manifest["recordingCoverage"]="host-snapshots-at-boundaries-or-10-game-seconds; full-streams-when-supported";
                paths.Atomic(Path.Combine(dir,"report-manifest.json"),manifest.ToJsonString(new JsonSerializerOptions(JsonSerializerOptions.Default){WriteIndented=true}));
                if(!File.Exists(last)) {
                    paths.Atomic(Path.Combine(dir,"first-snapshot.json"),snapshot.ToJsonString());
                    foreach(var name in new[]{"settings.json","custom-plans.json"}) {
                        var source=storage.DataPath(name);
                        if(File.Exists(source))paths.Atomic(Path.Combine(dir,"initial-config",name),File.ReadAllText(source));
                    }
                }
                // A detached/empty post-settlement state cannot erase equipment.
                if(snapshot["combat"] is not null)paths.Atomic(last,snapshot.ToJsonString());
                var row=Select(snapshot,["state","time","level","hp","maxHp","kills","damageTaken","tower","controllerVersion"]);
                row["observedAt"]=DateTimeOffset.Now.ToString("O");
                using(var stream=new FileStream(paths.Safe(Path.Combine(dir,"timeline.jsonl")),FileMode.Append,FileAccess.Write,FileShare.Read)) {
                    stream.Write(Encoding.UTF8.GetBytes(row.ToJsonString()+"\n"));stream.Flush(true);
                }
                WriteReadable(dir,manifest,snapshot,Read(dir,"settlement.json"));
                checkpoints[id]=(seconds,boundary);
            }
        }
        foreach(var end in settlements) {
            var receiptId=Text(end["id"]);var key=receiptId+":"+Text(end["saved"])+":"+Text(end["error"]);
            if(savedSettlements.Contains(key))continue;
            var at=Text(end["runAt"]);
            var id=byRunAt.GetValueOrDefault(at) ?? BattleReportPaths.Id(receiptId.StartsWith("run-")?null:receiptId,session+":"+at);
            var dir=paths.Run(id);var old=Read(dir,"settlement.json");
            // Never downgrade a durable successful receipt to an earlier failure.
            if(Text(old?["saved"])=="true" && Text(end["saved"])!="true"){savedSettlements.Add(key);continue;}
            end.Remove("id"); // Never persist the original native ticket.
            end["reportId"]=id;
            paths.Atomic(Path.Combine(dir,"settlement.json"),end.ToJsonString(new JsonSerializerOptions(JsonSerializerOptions.Default){WriteIndented=true}));
            var manifest=Read(dir,"report-manifest.json") ?? new JsonObject{["schemaVersion"]=1,["reportId"]=id,["recordingCoverage"]="settlement-only-no-invented-combat-history"};
            manifest["completed"]=Text(end["saved"])=="true";manifest["lastObservedAt"]=DateTimeOffset.Now.ToString("O");
            paths.Atomic(Path.Combine(dir,"report-manifest.json"),manifest.ToJsonString(new JsonSerializerOptions(JsonSerializerOptions.Default){WriteIndented=true}));
            if(CompletedName(end,Read(dir,"last-snapshot.json")) is {} stem) {
                dir=paths.FinalizeRun(id,stem);manifest["displayName"]=Path.GetFileName(dir);manifest["nameTimeZone"]="UTC+08:00";
                paths.Atomic(Path.Combine(dir,"report-manifest.json"),manifest.ToJsonString(new JsonSerializerOptions(JsonSerializerOptions.Default){WriteIndented=true}));
            }
            WriteReadable(dir,manifest,Read(dir,"last-snapshot.json"),end);savedSettlements.Add(key);
        }
        if(checkpoints.Count>4)foreach(var id in checkpoints.Keys.Take(checkpoints.Count-4).ToArray())checkpoints.Remove(id);
        if(byRunAt.Count>512)foreach(var key in byRunAt.Keys.Take(byRunAt.Count-512).ToArray())byRunAt.Remove(key);
        if(savedSettlements.Count>4096)foreach(var key in savedSettlements.Take(savedSettlements.Count-2048).ToArray())savedSettlements.Remove(key);
    }
    private JsonObject? Read(string dir,string name) {
        var path=paths!.Safe(Path.Combine(dir,name));return File.Exists(path)?JsonNode.Parse(File.ReadAllText(path))?.AsObject():null;
    }
    private void WriteReadable(string dir,JsonObject manifest,JsonObject? last,JsonObject? end)
    {
        var seconds=Number(end?["time"])??Number(last?["time"]);
        var lines=new[]{"本局战报", "归档编号："+manifest["reportId"],
            "状态："+(end is null?"记录中或未观察到结算（不等于已结束）":Text(end["saved"])=="true"?"已收到原生保存回执":"未确认保存"),
            "结束原因："+(Text(end?["endHow"]) is {Length:>0} how?how:"未知"),
            "游戏时间（秒）："+(seconds?.ToString(System.Globalization.CultureInfo.InvariantCulture)??"未知"),
            "到达层数："+(end?["towerFloor"]??last?["tower"]?["floor"]) ,
            "已清层数："+(end?["towerClearedFloor"]?.ToString()??"未知"),
            "last-snapshot.json：最后有效战斗配装；settlement.json：结算。二者属于同一局。",
            "timeline.jsonl：阶段快照；initial-config/：首次观察时的设置与模板。",
            "streams/：支持详细记录的版本所写的决策、回执、采样和分层时间账。",
            "没有记录的区间和伤害归因保持未知；本文件不把中断观察或主动退出当成通关。"};
        var display=Text(manifest["displayName"]);
        // Use the already validated directory name, never a manifest-supplied path.
        var filename=display.Length>0?Path.GetFileName(dir)+".txt":"summary.txt";
        paths!.Atomic(Path.Combine(dir,filename),string.Join(Environment.NewLine,lines)+Environment.NewLine);
        var old=paths.Safe(Path.Combine(dir,"summary.txt"));
        if(filename!="summary.txt"&&File.Exists(old))File.Delete(old);
    }
}
