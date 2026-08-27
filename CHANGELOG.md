# Changelog

## [0.0.20](https://github.com/stavarengo/folia-kanban/compare/0.0.19...0.0.20) (2026-08-27)

### Features

* create a board or convert a note, without hand-writing frontmatter ([f1da48d](https://github.com/stavarengo/folia-kanban/commit/f1da48d059ab659159698e14f38db29d06713971)), references [#1](https://github.com/stavarengo/folia-kanban/issues/1)
* **detail:** one link resolver, reported failures, a panel that follows its note, display title ([1605d59](https://github.com/stavarengo/folia-kanban/commit/1605d59924255e5f5822bd791792f3fc805c896b))
* tick a parent's checklist line when its subcard reaches Done ([b8c7e7b](https://github.com/stavarengo/folia-kanban/commit/b8c7e7bbf620de77de364de603607eeddca83e07))
* **ui:** copy a card's path from its right-click menu ([d3aa944](https://github.com/stavarengo/folia-kanban/commit/d3aa9441613d4bc4290841d0f8fe53a68b84350f))
* **ui:** rank a board's own priority scale on the colour ramp ([35636f1](https://github.com/stavarengo/folia-kanban/commit/35636f1f5681b08fc16d1114b9522b3cf62825b9))
* user-defined relationship types, blocked and unread filters ([ececc0f](https://github.com/stavarengo/folia-kanban/commit/ececc0f9647d9fbcf9d1342c922c034a3a31aa54))

### Bug Fixes

* **agents:** derive the Obsidian debug URL instead of assuming Docker's default bridge ([67fd1bd](https://github.com/stavarengo/folia-kanban/commit/67fd1bdc50c3c7a6bad7e307e98d0ced2a4a2390))
* **card:** judge the description the way it is written ([17f932d](https://github.com/stavarengo/folia-kanban/commit/17f932d606e9d01cbc0d8e483af1bdc09d065d4f))
* **card:** keep a comment's continuation lines as written ([208a536](https://github.com/stavarengo/folia-kanban/commit/208a536c2a22805081ef6f25febe42b2c5016a13))
* **card:** keep open fences and prose edits from swallowing sections ([4d57985](https://github.com/stavarengo/folia-kanban/commit/4d57985111fae0d02b1a5158c400c8b53e52a911))
* **card:** read fences and prose like the writers do ([fba0fc7](https://github.com/stavarengo/folia-kanban/commit/fba0fc7d758301adf518d3f748348e1caa4fabbb))
* **ci:** say what the community-scan job can and cannot fail on ([ea282f5](https://github.com/stavarengo/folia-kanban/commit/ea282f58e4609e5c8492991df635845685962e8f))
* decide a subcard tick before writing it, and record it as the move it is ([900e093](https://github.com/stavarengo/folia-kanban/commit/900e093c7a23472f6453a3e22135e6ed0103c528))
* **ds:** close the portal-scope guard's blind spots and the stale token docs ([2421f89](https://github.com/stavarengo/folia-kanban/commit/2421f8910c87de498fa053c9ed247e8bb184a4c8))
* **ds:** make the two design-system guards say what they actually check ([cc50c18](https://github.com/stavarengo/folia-kanban/commit/cc50c18d3a97e4bcd41ab7ed44f67972d66b50f3))
* **fences:** a backtick info string is not a fence ([cfea41a](https://github.com/stavarengo/folia-kanban/commit/cfea41a6bf2972198e175c91af5dac69dafbe028))
* flush only the tab the board replaces, not every tab on the note ([29d9bc9](https://github.com/stavarengo/folia-kanban/commit/29d9bc99da1502b0150bf28fdb1a4da276bf8a13))
* follow path-keyed state from the plugin, not only from an open board ([6512247](https://github.com/stavarengo/folia-kanban/commit/6512247698e9ad289f7bf6461161a0b3aebeb8bd))
* keep each guided board's cards its own, and its note's unsaved text ([44ffbed](https://github.com/stavarengo/folia-kanban/commit/44ffbed88afa7348bd57bff5e5d6aa295efe9fa2))
* keep the subcard tick byte-exact, reorder-safe, and mirrored in every note ([6287e65](https://github.com/stavarengo/folia-kanban/commit/6287e65c1148ac0f4893af0252658e9b649eb53a))
* name a subcard line by its link before writing into the child's note ([bd878e0](https://github.com/stavarengo/folia-kanban/commit/bd878e0aa8dfd863c8536b29dc501dbc9035e652))
* serialise settings writes so a fast rename chain cannot persist a stale snapshot ([7add928](https://github.com/stavarengo/folia-kanban/commit/7add9285769c961a519224364246b0d4b8ea410a))
* **test:** restore the describe boundary lost in the rebase ([90808d5](https://github.com/stavarengo/folia-kanban/commit/90808d54bd494e405f9c02066048c18c0e6391bc))
* **ui:** carry the design tokens into every portalled surface ([0a0d3f0](https://github.com/stavarengo/folia-kanban/commit/0a0d3f09d1dc2da88bbcfc2a8e64fb1f2fbc6be8))
* **ui:** colour a priority only by the scale the board note holds ([931a9d5](https://github.com/stavarengo/folia-kanban/commit/931a9d56c61a9a203918627d1825b862429975b4))
* **ui:** follow card UI state through renames done outside the board ([83da467](https://github.com/stavarengo/folia-kanban/commit/83da467b70590c408f451cb972a66953e9ffb7f1))
* **ui:** keep the theme's button face off the plugin's own buttons ([00b6cd7](https://github.com/stavarengo/folia-kanban/commit/00b6cd72f91cdd50c59c098c4f90548f43cd4487))
* **ui:** never let a copy action fail silently, and make the path-keyed list exhaustive ([eb753c1](https://github.com/stavarengo/folia-kanban/commit/eb753c181413d3fb129f5bfdc33621cb5545f51e))
* **ui:** strip the theme's raised face from the plugin's buttons ([bebc4c5](https://github.com/stavarengo/folia-kanban/commit/bebc4c56f035295afe1977be8fa00a6ee78e9f7c))
* write and log a parent's tick only where the note still needs it ([01f45e8](https://github.com/stavarengo/folia-kanban/commit/01f45e87307692da6a4fd1c78c688bef99c97549))

### Documentation

* **ci:** drop the build from what the community-scan job can fail on ([3bafe5b](https://github.com/stavarengo/folia-kanban/commit/3bafe5bad350c4a7737369be88b4b0688e89ad13))
* **examples:** mention the copy-path actions in the sample vault tour ([705b2ca](https://github.com/stavarengo/folia-kanban/commit/705b2ca9ea42d9d3175d663cbc6cd4ac0092929e))
* keep the forum precedent for a stuck portal listing ([508dcb8](https://github.com/stavarengo/folia-kanban/commit/508dcb826493a730575b4439af7f9fa7fcada945))
* **main:** say plainly that the file-op follow-up runs for the plugin's own renames too ([8e85fd0](https://github.com/stavarengo/folia-kanban/commit/8e85fd0d4f7a31d9fb85962ee1ce053eace69f50))
* match the file-menu setting's comment to what it governs ([43e04f3](https://github.com/stavarengo/folia-kanban/commit/43e04f315becdd43ff27e35d7192482ca49ee587))
* record the two decisions and run the project preflight in verify ([50e8079](https://github.com/stavarengo/folia-kanban/commit/50e8079c3fd532735f2198073410b84c19b8b24b))
* say that Obsidian rewrites the properties block on conversion ([53f324a](https://github.com/stavarengo/folia-kanban/commit/53f324a21d5cbb6eeaf8bff52bd5c478777e9eb7))
* **test:** say what the Obsidian fake covers and what extending it means ([61e2e9e](https://github.com/stavarengo/folia-kanban/commit/61e2e9e30e9e783a24c083880b97e6f4f59647d8))
* **ui:** say where a board's own priority words get their tone ([395a20c](https://github.com/stavarengo/folia-kanban/commit/395a20c574ceacfdeec248332893a7579cf19663))
* warn that a board's first learned priority list is not a ranking ([b0812a8](https://github.com/stavarengo/folia-kanban/commit/b0812a871c4c08b3f1cc9c134548d5b3e37b40bb))

### Tests

* make the file-op guards fail when the feature is wrong, and surface a failed save ([beb43c9](https://github.com/stavarengo/folia-kanban/commit/beb43c95e273d89e71f4e466db47b2d3e59756b4))
* **styles:** close the button check's blind spots and say what the scale decides ([4da625c](https://github.com/stavarengo/folia-kanban/commit/4da625c55a419db8999eb79fe5fa096ec051c23c))
* **ui:** guard the sort wiring and repair what doubling shadowed ([d653106](https://github.com/stavarengo/folia-kanban/commit/d653106f6227c7240102ef6b8a7dab03c7040996))
* **vault:** cover applyMove and drop the adapter-tests backlog entry ([e2564ba](https://github.com/stavarengo/folia-kanban/commit/e2564baf2c2d298b909fdca4e1053ef9f443faca))
* **vault:** cover the parent-checklist tick a subcard's move now writes ([20ac0be](https://github.com/stavarengo/folia-kanban/commit/20ac0be6f7b2d51e57ce7037759a42d570ae6941))
* **vault:** cover the vault adapter against an in-memory Obsidian fake ([0c7ee04](https://github.com/stavarengo/folia-kanban/commit/0c7ee04097f3c545ba889e651bd826598981817a))
* **vault:** make the adapter tests bite, and widen them to the untested writes ([68fa011](https://github.com/stavarengo/folia-kanban/commit/68fa011b8e68596f44b3490386a77a4e3e1652e9))

### Build & Tooling

* add Obsidian's community-scan action next to the local reproduction ([2c7a9af](https://github.com/stavarengo/folia-kanban/commit/2c7a9afd7d538062b1075efb1a02889d2f333bb1))

## [0.0.19](https://github.com/stavarengo/folia-kanban/compare/0.0.18...0.0.19) (2026-08-26)

### Features

* **settings:** describe the settings tab declaratively so search finds it ([ae3b70b](https://github.com/stavarengo/folia-kanban/commit/ae3b70b16aab765f1d35e5f76414ec5ee4dceb16))

### Bug Fixes

* **docs:** say what each check and each setting actually does ([6cb24cb](https://github.com/stavarengo/folia-kanban/commit/6cb24cbb36919ba44b366d104e4864141be6dc31))
* **settings:** refuse a control value that is not a number ([9c8c771](https://github.com/stavarengo/folia-kanban/commit/9c8c771b0e109c04be12fa71fb85e11f967d4c73))

### Refactoring

* **settings:** validate the typed name in one place ([5960909](https://github.com/stavarengo/folia-kanban/commit/5960909100f5bf4a71593c5b4162934a1b7ebcb7))

### Documentation

* **readme:** name checklist items as tasks, and guard the README against placeholders ([f547d96](https://github.com/stavarengo/folia-kanban/commit/f547d965d567e10e281926379bfd413861a194ab))

## [0.0.18](https://github.com/stavarengo/folia-kanban/compare/0.0.17...0.0.18) (2026-08-25)

### Bug Fixes

* **deps:** raise ten transitive packages past their advisories ([75da01e](https://github.com/stavarengo/folia-kanban/commit/75da01e1e15741352c8e666e48427e51498fcf40))
* **lint:** close two ways the a11y fence could be walked around ([7b54277](https://github.com/stavarengo/folia-kanban/commit/7b542771b6e92b2cb744df2eff87f0afff7bf5f3))
* **lint:** fail the a11y fence when an exception file is ignored by ESLint ([f4e6a19](https://github.com/stavarengo/folia-kanban/commit/f4e6a192fff0a1d71970c6a409eb9781cc0caff3))
* **lint:** restore the type-aware gate the obsidianmd preset scoping switched off ([3124b1f](https://github.com/stavarengo/folia-kanban/commit/3124b1f2949cea4a99140733c38cd722af6176c4))
* **lint:** scan only the files a fresh clone would contain ([dc44923](https://github.com/stavarengo/folia-kanban/commit/dc44923a328ef0a867c0195180b5c55e948d7219))

### Documentation

* **backlog:** add card path copy request ([bb5cd94](https://github.com/stavarengo/folia-kanban/commit/bb5cd9405f7023e3e1323410badd264ae2bb64a0))
* **backlog:** add create-board/convert-note commands entry ([ef49060](https://github.com/stavarengo/folia-kanban/commit/ef4906061eecd883077818578097de362772bec6))
* **backlog:** add portal-review-green entry, link relations ([e4114b2](https://github.com/stavarengo/folia-kanban/commit/e4114b2ffaee9b87254cc0536be1685593e2590d))
* **backlog:** generalise host-bridge entry ([69a7448](https://github.com/stavarengo/folia-kanban/commit/69a7448d0a1acd40387413fede588755bf7eaf14))
* **backlog:** renumber create-board entry to avoid collision ([88a5fb7](https://github.com/stavarengo/folia-kanban/commit/88a5fb7f96bd1e1a2d963d27cce7b0ac216ad77a))
* **backlog:** renumber settings-search entry to avoid collision ([145e7dc](https://github.com/stavarengo/folia-kanban/commit/145e7dc80f89a68614310138cc37d2ec4fb0df91))
* **backlog:** research portal sync and official lint action ([450d443](https://github.com/stavarengo/folia-kanban/commit/450d443e9abce3aec9f85a0e8125f14b7635656a))

### Build & Tooling

* **release:** write release notes from Conventional Commits ([d47f7c6](https://github.com/stavarengo/folia-kanban/commit/d47f7c6cca497576c83bdfc569199c8ca41f5d47))
* scan main on every push and refresh the actions ([3c3ae1d](https://github.com/stavarengo/folia-kanban/commit/3c3ae1d54ba5f35c531a60d845ed7af91aa156de))
