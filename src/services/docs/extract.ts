/** PDF / Word 附件文本提取，供内联进模型上下文 */

const MAX_CHARS = 24_000

export const extractPdf = async (blob: Blob): Promise<string> => {
  const pdfjs = await import('pdfjs-dist')
  // worker 以资源形式打包，离线可用
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise
  const parts: string[] = []
  for (let i = 1; i <= Math.min(doc.numPages, 40); i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    parts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
    if (parts.join('\n').length > MAX_CHARS) {
      break
    }
  }
  return parts.join('\n').slice(0, MAX_CHARS)
}

export const extractDocx = async (blob: Blob): Promise<string> => {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ arrayBuffer: await blob.arrayBuffer() })
  return result.value.slice(0, MAX_CHARS)
}

/** 按扩展名判断是否需要解析 */
export const isParsableDoc = (name: string): boolean => /\.(pdf|docx)$/i.test(name)