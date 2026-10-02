// winlist <owner name>: on-screen normal windows (layer 0) of that app as JSON [{pid, x, y, w, h}] — no titles, no pixels
import Foundation
import CoreGraphics
let owner = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Terminal"
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
var out: [[String: Int]] = []
for w in list where (w[kCGWindowOwnerName as String] as? String) == owner && (w[kCGWindowLayer as String] as? Int) == 0 {
  let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
  out.append(["pid": w[kCGWindowOwnerPID as String] as? Int ?? 0, "x": Int(b["X"] as? Double ?? 0), "y": Int(b["Y"] as? Double ?? 0), "w": Int(b["Width"] as? Double ?? 0), "h": Int(b["Height"] as? Double ?? 0)])
}
print(String(data: try! JSONSerialization.data(withJSONObject: out), encoding: .utf8)!)
