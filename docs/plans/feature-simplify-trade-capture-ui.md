# Simplify Trade Capture UI

## Goal

- Put upload and row review first.
- Push secondary analysis behind clear disclosure.
- Remove repeated chrome, copy, and status noise.

## Checklist

- [x] Capture design context in `.impeccable.md`
- [x] Simplify the page shell and hero copy
- [x] Compress the upload surface to one clear action path
- [x] Move review messaging next to the extracted rows
- [x] Hide holdings analysis and the weight chart behind disclosures

## Removed Complexity

- Removed the upload badge strip and footer status bar because they repeated metadata without helping the main task.
- Replaced the attachment action menu with a direct file button and moved the note field behind an optional disclosure.
- Moved success, review, and restore feedback to the extracted-trades section so users see status where they verify outcomes.
- Hid holdings analysis and the weight chart by default so portfolio tools no longer compete with ingestion.

## Monitor

- Do users want portfolio analysis to open automatically after a successful import?
- Do users need a more explicit way to inspect source-file provenance per row?

## Questions

- None.
