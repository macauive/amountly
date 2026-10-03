const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Execute the application's actual TypeScript with only explicit dependency overrides.
module.exports = function appLoader(overrides = {}, env = {}) {
  const cache = new Map()
  function load(file) {
    file = path.resolve(file)
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }
    cache.set(file, module)
    function localRequire(name) {
      if (Object.hasOwn(overrides, name)) return overrides[name]
      if (name.startsWith('@/')) {
        const base = path.resolve('src', name.slice(2))
        return load(fs.existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`)
      }
      return require(name)
    }
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, { module, exports: module.exports, require: localRequire, console,
      URL, URLSearchParams, Headers, Request, Response, Blob, File, TextEncoder, TextDecoder, AbortController, AbortSignal, fetch, crypto: require('node:crypto').webcrypto,
      process: { env }, setTimeout, clearTimeout }, { filename: file })
    return module.exports
  }
  return load
}
