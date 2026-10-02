// aecheck <bundle-id>: may this process's responsible app send Apple Events to <bundle-id>? Never prompts.
// prints 0 (granted), -1743 (denied), -1744 (not decided yet: a real call would prompt), -600 (target not running)
import Foundation
import CoreServices
let bid = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "com.apple.Terminal"
var target = AEAddressDesc()
let bytes = Array(bid.utf8)
let err = bytes.withUnsafeBufferPointer { AECreateDesc(DescType(typeApplicationBundleID), $0.baseAddress, $0.count, &target) }
if err != noErr { print("createdesc \(err)"); exit(2) }
print(AEDeterminePermissionToAutomateTarget(&target, AEEventClass(typeWildCard), AEEventID(typeWildCard), false))
AEDisposeDesc(&target)
