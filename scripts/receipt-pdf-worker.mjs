import { parentPort, workerData } from 'node:worker_threads'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

// Isolated parser only: do not render, evaluate document code, or execute actions.
const task = getDocument({
  data: workerData,
  isEvalSupported: false,
  useSystemFonts: false,
  disableFontFace: true,
  stopAtErrors: true,
  // Bound declared image width * height before decoding. This is a per-image
  // parser guard, not a limit on the worker's total process memory.
  maxImageSize: 25_000_000,
  verbosity: 0,
})
let passwordRequired = false
task.onPassword = () => {
  passwordRequired = true
  parentPort.postMessage(false)
  void task.destroy()
}
try {
  const pdf = await task.promise
  const { info } = await pdf.getMetadata()
  if (passwordRequired || info.EncryptFilterName !== null || pdf.numPages < 1 || pdf.numPages > 5) {
    parentPort.postMessage(false)
  } else {
    // Validate all accepted pages, rather than just the PDF header and metadata.
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      await page.getTextContent()
      await page.getOperatorList()
      page.cleanup()
    }
    parentPort.postMessage(true)
  }
} catch {
  parentPort.postMessage(false)
} finally {
  await task.destroy()
}
