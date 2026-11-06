import vm from "node:vm";

// These fixtures model a browser's ordinary global object. The default
// contextified sandbox is a separate backing object with Node-specific global
// interceptors; DONT_CONTEXTIFY exposes the realm's actual global proxy.
// Keep the realm's own intrinsics: never copy Node's Number/Math/etc into it.
export function createBrowserVmContext() {
  const context = vm.createContext(vm.constants.DONT_CONTEXTIFY);
  context.window = context;
  return context;
}
