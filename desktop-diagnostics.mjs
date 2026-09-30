// A desktop app can outlive the terminal that launched it. Node warnings and
// provider logs must not crash the app when that terminal closes its pipes.
let diagnosticWriter;
const pendingDiagnostics = [];

function recordDiagnostic(message) {
  if (diagnosticWriter) diagnosticWriter(message);
  else {
    pendingDiagnostics.push(message);
    if (pendingDiagnostics.length > 50) pendingDiagnostics.shift();
  }
}

export function setDesktopDiagnosticWriter(writer) {
  diagnosticWriter = writer;
  for (const message of pendingDiagnostics.splice(0)) writer(message);
}

export function guardTerminalPipe(stream, name, report = recordDiagnostic) {
  let disconnected = false;
  function onError(error) {
    if (error.code === 'EPIPE') {
      if (!disconnected) report(`${name}: launcher terminal disconnected (EPIPE)`);
      disconnected = true;
      return;
    }
    if (disconnected && error.code === 'ERR_STREAM_DESTROYED') return;
    // Preserve normal failure behavior for errors unrelated to a closed pipe.
    throw error;
  }
  stream.on('error', onError);
  return () => stream.off('error', onError);
}

// Install during module evaluation, before importing desktop services that may
// emit startup warnings (including SQLite's experimental feature warning).
guardTerminalPipe(process.stdout, 'stdout');
guardTerminalPipe(process.stderr, 'stderr');
process.on('warning', (warning) => recordDiagnostic(`Warning: ${warning.name}: ${warning.message}`));
