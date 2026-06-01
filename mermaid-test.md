# MD Editor Plus — architecture

A quick map of how the extension is wired, used to smoke-test the new mermaid block.

## How a `.md` file gets to your eyes

```mermaid
flowchart TB
    Disk[("*.md file on disk")]

    subgraph Host["VS Code extension host"]
        Provider["mdEditorPlusProvider.ts"]
    end

    subgraph Web["Webview"]
        Index["index.ts"]
        Theme["theme.ts"]
        Editor["editor.ts (Tiptap)"]

        subgraph Ext["Block extensions"]
            CB["CodeBlock"]
            MB["MermaidBlock"]
            Other["Callout / Board / Toggle / ..."]
        end

        subgraph Mer["Mermaid pipeline"]
            Renderer["mermaidRenderer<br/>cache + render queue"]
            FS["mermaidFullscreen"]
        end
    end

    Disk -->|read| Provider
    Provider -->|init / update| Index
    Index -->|edit| Provider
    Provider -->|write| Disk

    Index --> Theme
    Index --> Editor
    Editor --> Ext
    MB --> Renderer
    Theme -.->|subscribe| Renderer
    Renderer --> FS
```

## Mermaid block lifecycle

```mermaid
stateDiagram-v2
    [*] --> Preview: file opens
    Preview --> Editing: toggle on / double-click
    Editing --> Preview: toggle off / Esc / click outside
    Preview --> Error: parse fails
    Error --> Editing: click "Fix in source"
    Editing --> Error: exit with bad syntax
    Preview --> Fullscreen: click Expand
    Fullscreen --> Preview: Esc / Close
```

## Theme propagation

```mermaid
sequenceDiagram
    participant User
    participant Theme as theme.ts
    participant Renderer as mermaidRenderer
    participant Block as MermaidBlock

    User->>Theme: flip Light → Dark
    Theme->>Theme: applyTheme('dark')
    Theme->>Renderer: notify('dark')
    Renderer->>Renderer: re-init themeVariables
    Renderer-->>Block: mermaid-theme-changed
    Block->>Renderer: renderMermaid(source)
    Renderer-->>Block: svg (themed)
    Block->>User: updated diagram
```

## Plain text below — sanity check

If everything is wired right, the three blocks above render as diagrams and this paragraph stays as plain text. Toggle **Edit** on any of them to flip into source mode (the snackbar should fade in), and click **Expand** to open the fullscreen modal.
