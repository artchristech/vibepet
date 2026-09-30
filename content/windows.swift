// vp-windows — the frontmost app's front window: {app, pid, x, y, w, h} in global points (top-left origin, same as Electron's screen).
// CGWindowList bounds need no Accessibility permission.
import AppKit
import CoreGraphics

guard let app = NSWorkspace.shared.frontmostApplication else { print("{}"); exit(0) }
let pid = app.processIdentifier
let list = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
for w in list {
  guard (w[kCGWindowOwnerPID as String] as? Int32) == pid, (w[kCGWindowLayer as String] as? Int) == 0,
        let b = w[kCGWindowBounds as String] as? [String: Double], (b["Width"] ?? 0) > 200, (b["Height"] ?? 0) > 150 else { continue }
  let o: [String: Any] = ["app": app.localizedName ?? "", "bundle": app.bundleIdentifier ?? "", "x": b["X"]!, "y": b["Y"]!, "w": b["Width"]!, "h": b["Height"]!]
  FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: o))
  exit(0)
}
print("{}")
