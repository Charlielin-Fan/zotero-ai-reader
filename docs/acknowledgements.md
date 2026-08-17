# Acknowledgements and license audit

Audited 2026-08-17 (Asia/Shanghai). The release contains the project source,
documentation, and synthetic visual assets only. No source code from the
projects below is vendored or copied into this repository; the references are
listed to make the surrounding ecosystem and license boundaries explicit.

| Project/runtime | Relationship | License finding | Source |
| --- | --- | --- | --- |
| Zotero Desktop / Reader / bundled PDF.js | Required external runtime | Zotero states that its source is AGPLv3 unless a source file says otherwise. Zotero is not redistributed here. | [Zotero source-code notice](https://www.zotero.org/support/dev/source_code), [Zotero source](https://github.com/zotero/zotero) |
| Codex Skills format | Packaging model and authoring context | This project follows the public skill layout; no OpenAI source code is copied. | [Official Codex skill documentation](https://developers.openai.com/codex/skills/) |
| `cli-anything-zotero` / `zotero-cli` | Separate local bridge prerequisite | The upstream repository and package identify Apache-2.0. It is not vendored. | [Repository](https://github.com/PiaoyangGuohai1/cli-anything-zotero), [PyPI metadata](https://pypi.org/project/cli-anything-zotero/) |
| `zotero-codex-autonote` | Design-context review only | No license file was present in the reviewed public repository snapshot; no code was copied. | [Repository](https://github.com/scgibbon/zotero-codex-autonote) |
| `zotero-agent` | Design-context review only | The reviewed repository includes an MIT license; no code was copied. | [Repository](https://github.com/psiQAQ/zotero-agent), [license](https://github.com/psiQAQ/zotero-agent/blob/main/LICENSE) |
| `zotero-library-mcp` | Design-context review only | The README declares MIT; no code was copied. | [Repository](https://github.com/RaulSimpetru/zotero-library-mcp) |
| `zotero-mcp` | Design-context review only | The reviewed repository exposes an MIT license; no code was copied. | [Repository](https://github.com/54yyyu/zotero-mcp) |

The project itself is released under [MIT](../LICENSE). “No code was copied” is
a project provenance statement, not a legal opinion about independent ideas or
API compatibility. If a contributor adds third-party material, they must record
its source and license before merge.
