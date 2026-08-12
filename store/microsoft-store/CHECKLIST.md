# Microsoft Store (when Windows build ships)

Tauri can target Windows. Treat this as channel #4 after Mac direct + MAS + itch.

**Product:** Card Chest  
**Pricing:** One-time  
**Capabilities:** local filesystem for collection export; optional internet for images / BYOK

## Checklist

1. [ ] `tauri build` Windows NSIS / MSI
2. [ ] Partner Center account
3. [ ] Package MSIX or allow Store to wrap installer per current Partner Center rules
4. [ ] Reuse MAS listing screenshots adapted to Windows window chrome
5. [ ] Same privacy story: no account, local vault
