// vp-ocr — Apple Vision text boxes for each PNG given: [{file, w, h, lines:[{text, x, y, w, h}]}], boxes normalized, top-left origin.
import Foundation
import Vision
import ImageIO

var out: [[String: Any]] = []
for file in CommandLine.arguments.dropFirst() {
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: file) as CFURL, nil),
        let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { out.append(["file": file, "lines": []]); continue }
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = false
  try? VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
  let lines: [[String: Any]] = (req.results ?? []).compactMap { o in
    guard let t = o.topCandidates(1).first else { return nil }
    let b = o.boundingBox
    return ["text": t.string, "x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height]
  }
  out.append(["file": file, "w": img.width, "h": img.height, "lines": lines])
}
let data = try JSONSerialization.data(withJSONObject: out)
FileHandle.standardOutput.write(data)
