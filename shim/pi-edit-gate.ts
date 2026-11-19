// Pi extension used by the Claude SDK shim.
//
// VSCode's harness snapshots a file when it sees an Edit/Write tool_use and
// reads the "after" contents when the matching tool_result arrives. Pi executes
// tools immediately after emitting the assistant message, which can beat the
// harness's asynchronous "before" snapshot. Delay file mutations slightly so the
// snapshot reliably captures the pre-edit contents.
export default function (pi: any) {
  pi.on("tool_call", async (event: any) => {
    const name = String(event?.toolName || "").toLowerCase();
    if (name === "edit" || name === "write") {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  });
}
