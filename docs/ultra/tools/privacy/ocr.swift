import Foundation
import Vision
import AppKit
// usage: swift ocr.swift <listfile> <outjsonl>   (writes text locally; prints only counts)
let args = CommandLine.arguments
let files = try! String(contentsOfFile: args[1]).split(separator: "\n").map(String.init)
FileManager.default.createFile(atPath: args[2], contents: nil)
let out = FileHandle(forWritingAtPath: args[2])!
var done = 0
for f in files {
  guard let img = NSImage(contentsOfFile: f), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = false
  let h = VNImageRequestHandler(cgImage: cg, options: [:])
  try? h.perform([req])
  let lines = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
  let obj: [String: Any] = ["file": f, "lines": lines, "w": cg.width, "h": cg.height]
  let data = try! JSONSerialization.data(withJSONObject: obj)
  out.write(data); out.write("\n".data(using: .utf8)!)
  done += 1
}
print("ocr done \(done)/\(files.count)")
