# Extended Waves — Post v1.0.0

Queued additional waves to close all gaps after base v1.0.0 is complete.

## Wave 7: Real-Time WebSocket Integration
- Hook into N8N's push service (ws:// or wss:// at /push) instead of polling
- Parse N8N push events: executionFinished, nodeExecuteAfter, workflowExecutingNode
- Instant preview updates on node completion (not 4s poll delay)
- Show per-node progress indicator WHILE running (nodeExecuteAfter fires per node)
- Fallback to polling if WebSocket connection fails

## Wave 8: Advanced File Previews
- PDF: render first page via pdf.js (CDN) or show page count + download
- JSON/XML/CSV: syntax-highlighted preview with expandable tree
- Audio: waveform + play controls
- Download button on every preview (triggers binary download)
- Copy to clipboard (images)
- File size shown on all previews

## Wave 9: Execution History Panel
- Side drawer toggled by history icon in toolbar
- Shows last 20 executions: timestamp, status, which nodes had outputs, thumbnail strip
- Click any past execution to re-render its previews on canvas
- Compare mode: select two executions, diff their outputs side by side

## Wave 10: Production Deploy + Verify
- deploy.sh: full SSH deploy script (scp injector.js + nginx confs to server, reload nginx)
- verify.sh: curl n8n.pigeonfi.com, check response contains the script tag injection
- health-check: endpoint to verify /n8n-preview/injector.js is accessible
- Auto-version: update the ?v= cache buster in sub_filter conf on each deploy
