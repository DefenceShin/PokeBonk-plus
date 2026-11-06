using System.IO;
using System.Reflection;
using System.Runtime.Loader;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
var root=Path.GetFullPath(args[0]);
AssemblyLoadContext.Default.Resolving += (_,n)=>n.Name!.StartsWith("Microsoft.Web.WebView2.")?AssemblyLoadContext.Default.LoadFromAssemblyPath(Path.Combine(root,"source/client/lib",n.Name+".dll")):null;
var asm=AssemblyLoadContext.Default.LoadFromAssemblyPath(Path.Combine(root,"source/client/bin/Release/net8.0-windows/win-x64/PokeBonk Pilot.dll"));
var t=asm.GetType("PokeBonk.Client.MainWindow",true)!;
var keys=new[]{"autoUpgrade","autoUnlockItems","autoClaim","reserveMoveSlot"};
var f=t.GetField("config",BindingFlags.Instance|BindingFlags.NonPublic)!;
var obj=RuntimeHelpers.GetUninitializedObject(t);var defaults=t.GetMethod("Defaults",BindingFlags.Static|BindingFlags.NonPublic)!;
foreach(var mode in new[]{"fresh","missing","invalid","mixed"}){
 var c=(JsonObject)defaults.Invoke(null,null)!;
 for(int i=0;i<4;i++){var k=keys[i];if(mode=="missing")c.Remove(k);if(mode=="invalid")c[k]="true";if(mode=="mixed")c[k]=i%2==0;}
 f.SetValue(obj,c);t.GetMethod("ValidateConfig",BindingFlags.NonPublic|BindingFlags.Instance)!.Invoke(obj,null);
 for(int i=0;i<4;i++)if(c[keys[i]]!.GetValue<bool>()!=(mode=="mixed"&&i%2==0))throw new Exception(mode+" "+keys[i]);
 if(c["expandVitaminSlots"]!.GetValue<bool>()!=true)throw new Exception("unrelated slot setting changed");
}
Console.WriteLine("PASS compiled WPF host: four settings false on fresh/missing/malformed, explicit mixed values retained; no window opened");

var report=new JsonObject { ["maintenanceScope"] = new JsonObject { ["automaticPlay"] = false } };
t.GetField("compatibilityReport",BindingFlags.Instance|BindingFlags.NonPublic)!.SetValue(obj,report);
var prepareAction=t.GetMethod("PrepareHostAction",BindingFlags.Instance|BindingFlags.NonPublic)!;
foreach(var action in new[]{"start","resume","toggle"}) {
 try { prepareAction.Invoke(obj,new object[]{action}); throw new Exception("M1 auto start was allowed"); }
 catch(TargetInvocationException e) when(e.InnerException is InvalidOperationException actual && actual.Message.Contains("\u5c1a\u5f85\u6838\u9a8c")) { }
}
var adapter=(string)t.GetMethod("CompatibilityAdapterExpression",BindingFlags.Instance|BindingFlags.NonPublic)!.Invoke(obj,new object[]{"(globalThis.__M1_PREPARE=prepareGameSource,true)",true})!;
File.WriteAllText(Path.Combine(root,"evidence/host-adapter.js"),adapter);
Console.WriteLine("PASS actual host M1 action gate; emitted adapter through embedded resource dependency resolver");

var ts=asm.GetType("PokeBonk.Client.TowerSettings",true)!;
var flags=BindingFlags.Static|BindingFlags.NonPublic;
var tower=(JsonObject)ts.GetMethod("Defaults",flags)!.Invoke(null,null)!;
foreach(var (v,expected) in new (JsonNode?,int)[]{(null,0),(30,30),(1,1),(100,100),(-1,0),(101,0),("30",0)}){
 ts.GetMethod("Assign",flags)!.Invoke(null,new object?[]{tower,"tombExperienceFloor",v});
 if(tower["tombExperienceFloor"]!.GetValue<int>()!=expected)throw new Exception("floor");
}

var privateFlags=BindingFlags.Instance|BindingFlags.NonPublic;
var wanted=t.GetField("wantedRunIntent",privateFlags)!;
var generation=t.GetField("intentGeneration",privateFlags)!;
var currentOnly=t.GetField("currentRunOnlyIntent",privateFlags)!;
report["maintenanceScope"]=JsonNode.Parse("""{"stage":"M3","automaticPlay":true,"modeIds":["resources","map","autoManage","characters","shiny","appearance","wardrobe"],"biomeIds":["forest","desert","coast","glacier","canela","cave","encina","iris"]}""");
foreach(var (mode,biome,allowed) in new[]{("resources","forest",true),("map","glacier",true),("autoManage","auto",true),("characters","forest",true),("characters","encina",true),("shiny","forest",true),("appearance","forest",true),("wardrobe","forest",true),("tower","forest",false),("resources","canela",true),("map","cave",true),("map","encina",true),("resources","iris",true),("resources","unknown",false)}) {
 foreach(var action in new[]{"start","resume","toggle"}) {
  var c=(JsonObject)defaults.Invoke(null,null)!;c["mode"]=mode;c["modeSettings"]=new JsonObject{[mode]=new JsonObject{["biome"]=biome}};
  f.SetValue(obj,c);wanted.SetValue(obj,false);currentOnly.SetValue(obj,false);long before=(long)generation.GetValue(obj)!;
  try { var result=(string)prepareAction.Invoke(obj,new object[]{action})!;if(!allowed)throw new Exception("unsupported action allowed");if((long)generation.GetValue(obj)!=before+1||!(bool)wanted.GetValue(obj)!)throw new Exception("manual intent not armed once"); }
  catch(TargetInvocationException e) when(!allowed&&e.InnerException is InvalidOperationException actual&&actual.Message.Contains("\u5c1a\u672a\u6838\u9a8c")) {if((bool)wanted.GetValue(obj)!||(long)generation.GetValue(obj)!=before)throw new Exception("blocked route armed an intent");}
 }
}
var cfg=(JsonObject)defaults.Invoke(null,null)!;cfg["mode"]="resources";cfg["autoStart"]=true;cfg["autoRestart"]=true;f.SetValue(obj,cfg);wanted.SetValue(obj,false);currentOnly.SetValue(obj,false);
var storage=Activator.CreateInstance(asm.GetType("PokeBonk.Client.PortableStorage",true)!,new object?[]{Path.Combine(root,"isolated-user-data/host-check-storage"),null});
t.GetField("portable",privateFlags)!.SetValue(obj,storage);
t.GetField("customPlans",privateFlags)!.SetValue(obj,new JsonArray());
t.GetField("catalog",privateFlags)!.SetValue(obj,JsonNode.Parse(File.ReadAllText(Path.Combine(root,"source/data/catalog.json"))));
t.GetField("shinyCatalog",privateFlags)!.SetValue(obj,JsonNode.Parse(File.ReadAllText(Path.Combine(root,"source/data/shiny-catalog.json"))));
foreach(bool reload in new[]{false,true}) {
 var bundle=(string)t.GetMethod("Bundle",privateFlags)!.Invoke(obj,new object[]{reload})!;
 if(!bundle.Contains("installPilot({\"autoStart\":false"))throw new Exception("cold/reconnect Bundle auto-started");
 if((bool)wanted.GetValue(obj)!)throw new Exception("Bundle armed start intent");
 File.WriteAllText(Path.Combine(root,reload?"evidence/host-bundle-reconnect.js":"evidence/host-bundle.js"),bundle);
}
Console.WriteLine("PASS compiled M3 host: 42 manual route/action gates, blocked routes leave intent unchanged, allowed actions arm once; cold/reload bundle autoStart false despite legacy true settings, no intent armed");

var setter=t.GetMethod("SetModeRouteField",BindingFlags.Static|BindingFlags.NonPublic)!;
foreach(var look in new[]{"l1","l2","l3"}){var route=new JsonObject();setter.Invoke(null,new object?[]{route,"look",JsonValue.Create(look)});if((string?)route["look"]!=look)throw new Exception("Current legendary wardrobe option was discarded: "+look);}
Console.WriteLine("PASS legendary look settings retained by actual host setter");
