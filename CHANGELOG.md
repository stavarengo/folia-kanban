# Changelog

## [0.4.1](https://github.com/stavarengo/folia-kanban/compare/0.4.0...0.4.1) (2026-09-23)

### Features

* add documented host variable registry ([f4f1e64](https://github.com/stavarengo/folia-kanban/commit/f4f1e643dc6f7836fbf2d1851ee786864bbedcde))
* **columns:** store a column colour as a theme colour name ([81bb84e](https://github.com/stavarengo/folia-kanban/commit/81bb84ec401b1569956f0716a004589966669096))
* **theme:** make every design value a token that is an alias or owned ([6e75d04](https://github.com/stavarengo/folia-kanban/commit/6e75d04a7a35f3a9778db6129a91442f6f728ed5))
* **theme:** record a fallback as part of the alias rather than as a reason to own ([c2b6ee3](https://github.com/stavarengo/folia-kanban/commit/c2b6ee3e3a13297c9654ae613354702a51ea457c))

### Bug Fixes

* adopt host layout and typography scales ([10cebf3](https://github.com/stavarengo/folia-kanban/commit/10cebf395e03bf0847f227b5aa560f1bd9f954b5))
* adopt native button faces ([26509c3](https://github.com/stavarengo/folia-kanban/commit/26509c3cb12423eaa7aa9f42a314d9ad61ed2635))
* align a subitem's parent reference with its card body ([fbb14a2](https://github.com/stavarengo/folia-kanban/commit/fbb14a2021b2dbdebe863de3edc9dcf055757663))
* answer the fifth review round ([a8a66cb](https://github.com/stavarengo/folia-kanban/commit/a8a66cbe3127c723af75c74b8507bcaf5cb8654c))
* answer the first review round ([f68e75c](https://github.com/stavarengo/folia-kanban/commit/f68e75c5093a3a70a8979854061bf73380c99801))
* answer the second review round ([9096f89](https://github.com/stavarengo/folia-kanban/commit/9096f8945223488258c7595ebc0c6cc2806eb261))
* answer the third review round ([bfc8111](https://github.com/stavarengo/folia-kanban/commit/bfc81118eda1a587b9407bb093d251e7780607a9))
* cap the column menu at the host popover max height ([70338a1](https://github.com/stavarengo/folia-kanban/commit/70338a172b0c7c2d65e99f9603aa058034c47239))
* check cycles across theme schemes ([6e59438](https://github.com/stavarengo/folia-kanban/commit/6e5943800b2cb0eb893d76dc1467ee25bb595827))
* close button guard coverage gaps ([890bdd3](https://github.com/stavarengo/folia-kanban/commit/890bdd3cb9f17928043b83b68b3ade155a3b5e02))
* correct theme geometry and icon isolation ([8d76da0](https://github.com/stavarengo/folia-kanban/commit/8d76da05a27735a9018659fc9f4e64653341ed80))
* draw the panel resize edge as an Obsidian divider ([44f79ea](https://github.com/stavarengo/folia-kanban/commit/44f79ea461d5f21e604ebafb9c71a2c92f6a6698))
* dress both dialogs in the host modal and dialog variables ([d1557f7](https://github.com/stavarengo/folia-kanban/commit/d1557f77d8a0ff15f84e1b7f8544b43d5bec107a))
* indent nested cards on the host nesting guide ([bbda30a](https://github.com/stavarengo/folia-kanban/commit/bbda30a931cdc001bdbe69dd7e1720a860f2c7b0))
* let a light-mode dialog detach from the board again ([0a250c9](https://github.com/stavarengo/folia-kanban/commit/0a250c9f85abd50cdbfbf803cfa36d5656b36085))
* let Obsidian's own select rule paint the board's dropdowns ([1648607](https://github.com/stavarengo/folia-kanban/commit/16486078d8c693ae2196af2379f240dabdccedcc))
* measure a card title's clearance from the cluster it clears ([4f619c5](https://github.com/stavarengo/folia-kanban/commit/4f619c58b9b10ac753947b622effdff2a826b6ad))
* preserve button interaction signals ([7d79c4f](https://github.com/stavarengo/folia-kanban/commit/7d79c4f7589bbcf31d5ca25be62df557b876c2f8))
* preserve choice shapes across pointer states ([6a640ee](https://github.com/stavarengo/folia-kanban/commit/6a640eeaa06df94843417705dc06a1824bddf00b))
* preserve clearance for themed card actions ([ac0043d](https://github.com/stavarengo/folia-kanban/commit/ac0043dee0b5388ce147ee5c09cffccb04681502))
* preserve host variable metadata deterministically ([7a27b85](https://github.com/stavarengo/folia-kanban/commit/7a27b852fb972e5a71b866fade3d858a84e618fa))
* shape chips from the host tag and pill geometry ([c33fad2](https://github.com/stavarengo/folia-kanban/commit/c33fad2645e456b9b9486a1f72e42fe7333def74))
* size colour swatches from the host swatch variables ([1a82e51](https://github.com/stavarengo/folia-kanban/commit/1a82e511244144602bb352e727979fc038cc463d))
* size icons through host CSS variables ([2f76a0b](https://github.com/stavarengo/folia-kanban/commit/2f76a0bbeaedf86091430ef076ff810aae0ea19e))
* soften elevation in light themes ([371ad6b](https://github.com/stavarengo/folia-kanban/commit/371ad6bfc4feb55c21af44c0ed8a5ac1cdb46420))
* take the comment rule and notice corner from the theme ([30c5033](https://github.com/stavarengo/folia-kanban/commit/30c5033e36d0ab8c1d5e3f23a528ab9c7378bf25))
* take the focused border from the host focus colour ([a7e3eb0](https://github.com/stavarengo/folia-kanban/commit/a7e3eb0ffd1e90c90de2fe1bcfea8adc3ccd7672))
* take the todo marker's shape from the host checkbox ([00f5fac](https://github.com/stavarengo/folia-kanban/commit/00f5facd2e90f32c4ef3602c0c51bce73c92dd4f))
* **theme:** close the holes a reviewer could walk through in the guard and the proof ([3bd3467](https://github.com/stavarengo/folia-kanban/commit/3bd3467bf28f43fd41267e45aac17ce39e0695f5))
* **theme:** close the two holes a reviewer got through, and stop claiming guards that do not guard ([eac6f92](https://github.com/stavarengo/folia-kanban/commit/eac6f9272e5810c4fc15e48e8c6330b739362bfb)), references [#fff](https://github.com/stavarengo/folia-kanban/issues/fff)
* **theme:** colour icons with the icon colours, not with text colours ([007b914](https://github.com/stavarengo/folia-kanban/commit/007b9147a96aff7762285b1e941423f38d2d84f9))
* **theme:** correct the icon state mapping, and make two hover rules render ([673cfca](https://github.com/stavarengo/folia-kanban/commit/673cfcac8a6974ad9fc01ccb31fdfad804c2f0ef))
* **theme:** draw a done item the way the vault draws a ticked checklist line ([4589a64](https://github.com/stavarengo/folia-kanban/commit/4589a645e53bad2626901539f7b9fd4408753bcc))
* **theme:** draw links the way the vault draws links ([72f5689](https://github.com/stavarengo/folia-kanban/commit/72f56894bba8c9d844d75e730b5071cdbd0a1c53))
* **theme:** draw the pressed ring inside the control, not outside it ([bb6e3b1](https://github.com/stavarengo/folia-kanban/commit/bb6e3b1381f159f5442472a3e190843f6755f433))
* **theme:** indicate search focus once, on the field the user sees ([7daf7c2](https://github.com/stavarengo/folia-kanban/commit/7daf7c2a3134239b97dae1548821896babba1c45))
* **theme:** keep the add-column tile dashed while the pointer is on it ([c0ae2e1](https://github.com/stavarengo/folia-kanban/commit/c0ae2e154e3562d5b9ea21fe9e7eed1c3b1e6a33))
* **theme:** keep the swatch a full circle, and stop the ninth one inviting a click ([bed6641](https://github.com/stavarengo/folia-kanban/commit/bed66415e190f0f717cca7c326a21887835f5fb2))
* **theme:** keep the title row out of the link hover, and refuse a fallback that cannot be right ([a806747](https://github.com/stavarengo/folia-kanban/commit/a8067471bc0f35b79dbc884120f6366d79e1da3b)), references [#ababab](https://github.com/stavarengo/folia-kanban/issues/ababab)
* **theme:** make the guard read CSS rather than its spelling, and the proof see who wrote a token ([f3d3090](https://github.com/stavarengo/folia-kanban/commit/f3d30902218033e79aa800ee930549cf5599dd57))
* **theme:** measure rule E against the token's own family, not a path that never matched ([d334a39](https://github.com/stavarengo/folia-kanban/commit/d334a39a7cb1918a0b62a13e8ad7293f5dde9133))
* **theme:** measure the variables before trusting their names ([c425b75](https://github.com/stavarengo/folia-kanban/commit/c425b75a3d89ca503d3a0ab25a3ff6033e204334)), references [#fb464c](https://github.com/stavarengo/folia-kanban/issues/fb464c)
* **theme:** move the pressed ring to the edge instead of shrinking the control ([f886ff0](https://github.com/stavarengo/folia-kanban/commit/f886ff003168983bc95194484a24a0b175f82e58))
* **theme:** paint accented text with the accent-text colour, not the accent fill ([aeaa437](https://github.com/stavarengo/folia-kanban/commit/aeaa437e0e09178cc111ca4d53cacc889ca9e725))
* **theme:** paint form fields with the theme's form-field background ([f00ca0a](https://github.com/stavarengo/folia-kanban/commit/f00ca0a6305cb3fb5d601a0f81ea9f291edcdd3b))
* **theme:** read Obsidian's colours without a literal behind them ([7242a58](https://github.com/stavarengo/folia-kanban/commit/7242a58bcd007bd6114915f993db257f06598f41))
* **theme:** rest a menu row transparent, as Obsidian's own menu rows do ([336fd6e](https://github.com/stavarengo/folia-kanban/commit/336fd6e620006d1e596dd86ef18eb41daba2e7cb)), closes [#ffffff](https://github.com/stavarengo/folia-kanban/issues/ffffff)
* **theme:** set button labels at the host's --font-ui-small ([ba7348e](https://github.com/stavarengo/folia-kanban/commit/ba7348e59067fcbbffa9349b75eea8f9a46bf595))
* **theme:** shrink a pressed control instead of tinting its face ([8863d8a](https://github.com/stavarengo/folia-kanban/commit/8863d8aadd98bfd188759e4548242afdd5e48733))
* **theme:** source the error, warning and success states from their own colours ([4f57106](https://github.com/stavarengo/folia-kanban/commit/4f571068d29e5c711fee6943dfa71d140ef3c366))
* **theme:** start a menu row's content at the leading edge ([51db23c](https://github.com/stavarengo/folia-kanban/commit/51db23caf783fc69bd6f0bee30b749e1abea6820))
* **theme:** stop a themed gradient painting over a swatch, and drop a link claim the scan forbids ([2c6a081](https://github.com/stavarengo/folia-kanban/commit/2c6a081436e13fd192ffc15ce9ccd050f4bf02bd))
* **theme:** stop the guard answering to spelling, and make it read CSS the way CSS is written ([7671cf1](https://github.com/stavarengo/folia-kanban/commit/7671cf1d71250bcc1279be66c715a9c0848cc7b3))
* **theme:** suppress the host focus ring the search input still drew ([365f2a0](https://github.com/stavarengo/folia-kanban/commit/365f2a0a58c0bb9a1193ef9de5f1c0ac54119c1c)), references [#555555](https://github.com/stavarengo/folia-kanban/issues/555555) [#bdbdbd](https://github.com/stavarengo/folia-kanban/issues/bdbdbd)
* **theme:** take the drop target and the column header from the theme ([3d0bc96](https://github.com/stavarengo/folia-kanban/commit/3d0bc96073f8f74e07cdda27a38ce14a18dc4e6e))
* **theme:** tint a pressed control's face, not only its outline ([38f24dc](https://github.com/stavarengo/folia-kanban/commit/38f24dc436bfc3877f26fa75fb124be088ef9ea7)), references [#333333](https://github.com/stavarengo/folia-kanban/issues/333333)
* **theme:** write the host registry even when the sync warns ([7fc3ba9](https://github.com/stavarengo/folia-kanban/commit/7fc3ba93aee4e764c6e991ba782b14625fbca753))
* type property rows from the host metadata variables ([1f388e6](https://github.com/stavarengo/folia-kanban/commit/1f388e6bdcade49a787118e2db0767bff0e100d7))
* **ui:** ring the No colour swatch when the note stores no colour ([073f78b](https://github.com/stavarengo/folia-kanban/commit/073f78b31b0d4e52b3cac25291f6f2ef2b4138b0))

### Refactoring

* **theme:** keep the cue strips, the underline and the nested radius out of the spacing rhythm ([918694d](https://github.com/stavarengo/folia-kanban/commit/918694d41987ce0ed6618e8c7396c188341be2ac))
* **theme:** mix in the space the app mixes in, where it costs nothing ([9291766](https://github.com/stavarengo/folia-kanban/commit/929176632e3be42fdd442f93fe09741dd9040ef4))
* **theme:** split the stylesheet into src/theme and bundle it with esbuild ([63de2fa](https://github.com/stavarengo/folia-kanban/commit/63de2fa2fe06971640cf5a9bce4a7f128f17e894))
* **ui:** pass the swatch fill through a custom property ([6d2db50](https://github.com/stavarengo/folia-kanban/commit/6d2db5000c22bd4e81453bc377d1c96794647134))

### Documentation

* **agents:** define when a change is breaking ([051b8e5](https://github.com/stavarengo/folia-kanban/commit/051b8e5345edbaecd57d9314b8f3fe0205665633))
* **agents:** reload the plugin before reading the live stylesheet ([ef3766b](https://github.com/stavarengo/folia-kanban/commit/ef3766b8d6cf27dc9ea329b91ca02ccca65c1367))
* clarify theme cycle coverage ([ae92112](https://github.com/stavarengo/folia-kanban/commit/ae92112f9da54d10483cb1d97f73693b7c232f03))
* correct three claims the fourth review round caught ([57d28e9](https://github.com/stavarengo/folia-kanban/commit/57d28e9baf976a97004e6eed4952e21150ca5846))
* name the Obsidian build the live readings came from ([43caf46](https://github.com/stavarengo/folia-kanban/commit/43caf46e3deba85bebecfce07f7591dabe12f0e4))
* point the Phase 1 audit bullets at the commits that exist ([a0a77c1](https://github.com/stavarengo/folia-kanban/commit/a0a77c138df731d404086f345f8e42e47f9997dc))
* re-point the Phase 1 audit bullets after the rebase onto Phase 3 ([67f6a29](https://github.com/stavarengo/folia-kanban/commit/67f6a2976984f12594c13e60b0d88090290f2a97))
* re-point the Phase 1 audit bullets after the rebase onto the Phase 2 fixes ([8db3df6](https://github.com/stavarengo/folia-kanban/commit/8db3df699e2a399cd37c9c0caaa41b302e2ad4d7))
* reconcile the accounting after the reversals ([f565442](https://github.com/stavarengo/folia-kanban/commit/f565442886158c2f808bbea24bbbcf7136261dc9))
* record button review corrections ([4d50e2b](https://github.com/stavarengo/folia-kanban/commit/4d50e2b843272783a12c18eff09cd59f21cf2bcc))
* record button theme verification ([11d74e2](https://github.com/stavarengo/folia-kanban/commit/11d74e22ff7b096af838ed087ce0b7e70b29e359))
* record final button state verification ([f794868](https://github.com/stavarengo/folia-kanban/commit/f7948686fefa2254edcbbf11167ec2dc734e1e59))
* record foundation review corrections ([988f1db](https://github.com/stavarengo/folia-kanban/commit/988f1dbc424865ae8065261ac53b817f23ffe4fd))
* record second button review fixes ([bd83a3d](https://github.com/stavarengo/folia-kanban/commit/bd83a3d72e49c29547e8ae9992a2c21e1adbc530))
* record what Phase 1 kept of Folia's own colour, and which commit resolved what ([8edfaf0](https://github.com/stavarengo/folia-kanban/commit/8edfaf00b4cc0b2a5abeff368a001b7b54c328da))
* record what the live pass measured on the branch ([269c2e8](https://github.com/stavarengo/folia-kanban/commit/269c2e8b4adc532997b7e346c6c932609ff31844))
* record what the live review found already settled ([95ba4ea](https://github.com/stavarengo/folia-kanban/commit/95ba4eae0a9575321712a7b5203c7732f1f9b290))
* **reports:** fold the five link findings into one, keeping the ids as anchors ([f7ccdff](https://github.com/stavarengo/folia-kanban/commit/f7ccdfff17ffe63a854628b3ca7806dadfe776e1)), closes [#40](https://github.com/stavarengo/folia-kanban/issues/40), references [#56](https://github.com/stavarengo/folia-kanban/issues/56)
* **reports:** record 01-10 as resolved by the icon-size adoption ([859d12b](https://github.com/stavarengo/folia-kanban/commit/859d12b3ebd0bab7a95e7aec83fa73e187870b0b))
* **reports:** renumber the audit report's file:line pointers to HEAD ([6e70652](https://github.com/stavarengo/folia-kanban/commit/6e7065201c63c261a041fb148175d3544685021f))
* **reports:** restate the audit's premises and counts against today's repo ([6534a21](https://github.com/stavarengo/folia-kanban/commit/6534a2185c0c96955d23c1f0fd5ea795c9b042e2))
* **reports:** stamp the audit findings that code has since resolved or moved ([3364509](https://github.com/stavarengo/folia-kanban/commit/33645091ecf1e9766c8817f17608fcd7932b0398))
* **theme:** record the live readings, on the version they were actually taken on ([8dec70d](https://github.com/stavarengo/folia-kanban/commit/8dec70d849b28e3033027cc11f0017273a3dac78))
* **theme:** say that the math-function multiplier list is narrow on purpose ([d75bca1](https://github.com/stavarengo/folia-kanban/commit/d75bca141413456fbaefeba87992a523cae91e55))
* **theme:** state what the button change did not fix, and name the swatch for its state ([2d02915](https://github.com/stavarengo/folia-kanban/commit/2d02915afe6bc39afb1f8ec6f75688ad16317aa7))
* **theme:** write down the domain, the class-name decision and the retired ratchet ([dce4a19](https://github.com/stavarengo/folia-kanban/commit/dce4a19481242393a0669e49d06deca42b0027a9))

## [0.4.0](https://github.com/stavarengo/folia-kanban/compare/0.3.2...0.4.0) (2026-09-19)

### ⚠ BREAKING CHANGES

* **mcp:** move_card on a checklist line (a `#todo:N` path, or a placed todo named by its text) now requires `line`, exactly as get_board or get_card reported it. Calls that passed only the card are refused.

### Features

* **mcp:** hold move_card of a checklist line to the agent's reading ([e2c4fd1](https://github.com/stavarengo/folia-kanban/commit/e2c4fd1ace70b409f680d8b35139a1c3daa331b0)), closes [#53](https://github.com/stavarengo/folia-kanban/issues/53)

### Bug Fixes

* **subtasks:** hold every checklist-line write to the reading it was decided on ([91fc33d](https://github.com/stavarengo/folia-kanban/commit/91fc33dc51eadca7b771d3f887712d07b388f995)), closes [#51](https://github.com/stavarengo/folia-kanban/issues/51)

### Documentation

* **reports:** estimate how often the stale-reading bug family can happen, with before/after diagrams ([f30180d](https://github.com/stavarengo/folia-kanban/commit/f30180dc91baefc38b0c45b58948ed6c7186ac78)), references [#36](https://github.com/stavarengo/folia-kanban/issues/36) [#37](https://github.com/stavarengo/folia-kanban/issues/37) [#50](https://github.com/stavarengo/folia-kanban/issues/50)

## [0.3.2](https://github.com/stavarengo/folia-kanban/compare/0.3.1...0.3.2) (2026-09-15)

### Bug Fixes

* **subtasks:** act on the checklist line a right-click menu was raised on ([ebcda15](https://github.com/stavarengo/folia-kanban/commit/ebcda15b211a3f2cd5acbec7b8f79ab0c888b128)), closes [#50](https://github.com/stavarengo/folia-kanban/issues/50)

## [0.3.1](https://github.com/stavarengo/folia-kanban/compare/0.3.0...0.3.1) (2026-09-15)

### Bug Fixes

* **subtasks:** decide a checklist line's column claim against the note, not a stale reading ([120f458](https://github.com/stavarengo/folia-kanban/commit/120f458bb2b8fc433b40fc9b689d295b8d3efeb2)), closes [#36](https://github.com/stavarengo/folia-kanban/issues/36)
* **subtasks:** say so when a checklist line cannot be given the column that was picked ([48910d4](https://github.com/stavarengo/folia-kanban/commit/48910d43b12f8664f24a4461e86d39cb7b7c089b)), closes [#37](https://github.com/stavarengo/folia-kanban/issues/37)

### Documentation

* **backlog:** link entries to their GitHub issues ([f2a3b86](https://github.com/stavarengo/folia-kanban/commit/f2a3b8698ab6b26d43b14c3d4438254644c9d777))
* **backlog:** move entries to GitHub issues ([662e87f](https://github.com/stavarengo/folia-kanban/commit/662e87f6b1a630d398a23d03e6eb71dd41df2fac))
* **backlog:** question the tight allowed-actions list ([e39eb96](https://github.com/stavarengo/folia-kanban/commit/e39eb9656edfe8d153f728d40e66489b38d3ec79))
* **backlog:** record how the dependency scanner fits the pipeline ([3e8faa8](https://github.com/stavarengo/folia-kanban/commit/3e8faa8d3fd87d726a11387d28693c1c90727216))
* **backlog:** reword entries for filing as issues ([3fe7b2a](https://github.com/stavarengo/folia-kanban/commit/3fe7b2a988551c22eef058d7a6af6e7cc4d9808b))
* **releasing:** say where the release App's credentials are kept ([c41a6b9](https://github.com/stavarengo/folia-kanban/commit/c41a6b9363230b3e3523e8131d0393142fec261b))
* tidy wording in notes and comments ([55b6af4](https://github.com/stavarengo/folia-kanban/commit/55b6af4dfdb535316a35c1ff3afa1a14d51ece11))

### Build & Tooling

* **deps:** reshape the Dependabot pull requests, and correct what the docs claim ([3686538](https://github.com/stavarengo/folia-kanban/commit/36865380c756a84f8262d751e82641289e2cc04b))
* **deps:** resolve the four dependency advisories ([2442aee](https://github.com/stavarengo/folia-kanban/commit/2442aeec5fceb26c78e3ac75ad15ffc788ad5e70))
* drop Dependabot version updates ([db9768b](https://github.com/stavarengo/folia-kanban/commit/db9768b958a19513ccf50a7f6991e00a20b76691))
* report dependency advisories, block them only where they ship ([206d4f1](https://github.com/stavarengo/folia-kanban/commit/206d4f1c33b1dec3b47e7227fa02dc12c5ea5d30))

## [0.3.0](https://github.com/stavarengo/folia-kanban/compare/0.2.0...0.3.0) (2026-09-11)

### ⚠ BREAKING CHANGES

* drop the announce job
* release on dispatch only, and review the plan in the run summary
* the Create Release and Release workflows are gone, and so is
  the FOLIA_KANBAN_RELEASE_IT_GITHUB_TOKEN secret they used - the pipeline pushes
  with GITHUB_TOKEN, and nothing is triggered by a tag push any more. Delete that
  secret and revoke the token. Releases now wait for an approval on a release
  environment whose required-reviewer rule is a repository setting, and
  pnpm dev:helpers:release dispatches the pipeline through the gh CLI instead of
  running release-it locally, so gh must be installed and authenticated.

### Features

* **release:** let the local script approve the gate as the gh user ([4e60cfe](https://github.com/stavarengo/folia-kanban/commit/4e60cfe8a2c6ffbbb1acb93b29a693b34b9bf48d))
* **release:** make the runner enforce what the dispatcher approved ([5e3f06a](https://github.com/stavarengo/folia-kanban/commit/5e3f06aa3ffd9a8ed4eb967ab2995c4da99bb1bb))

### Bug Fixes

* **release:** bind the changelog boundary, and read subjects the preset's way ([601b6ee](https://github.com/stavarengo/folia-kanban/commit/601b6ee09d5edfa375350ca8b6c410426097da98))
* **release:** compare remote hosts without the port ([17ada23](https://github.com/stavarengo/folia-kanban/commit/17ada2324f301c0afcaa457cc04af1220288463b))
* **release:** hold the dispatched run to the commit that was reviewed ([135405d](https://github.com/stavarengo/folia-kanban/commit/135405d38e7c6e8bbc15316a8b699191a4b3152d))
* **release:** only republish a commit release-it made, and close the cache channel ([a439dad](https://github.com/stavarengo/folia-kanban/commit/a439dad7969e5838b9114e840dbf05d834069e27))
* **release:** read the footer out of the body, not the whole message ([ae53832](https://github.com/stavarengo/folia-kanban/commit/ae53832abf2f44ca6416b10fd574da1e90a183dc))
* **release:** read the tags release-it will read, not the ones we cloned ([1505c6c](https://github.com/stavarengo/folia-kanban/commit/1505c6c90d66021fe3d7219e2ca234538608e2c6))
* **release:** require plan to have succeeded, and check drift, not the run id ([c47f86e](https://github.com/stavarengo/folia-kanban/commit/c47f86edc7597cdb5f3a2891d35bce1fb1c2cb27))
* **release:** restore the sleep the fallback polls with ([32d8cf1](https://github.com/stavarengo/folia-kanban/commit/32d8cf19a32f2515c3d3eaa93053a92cd9934af4))
* **release:** say which repository, and identify the run by the id gh gives back ([9275109](https://github.com/stavarengo/folia-kanban/commit/92751093be1279f1ad2154d815983ca67c14bce8))

### Documentation

* file the release-gate decision, and name the portal's manual release check ([8891f24](https://github.com/stavarengo/folia-kanban/commit/8891f24e81587b93716cbea4fc01a6e296358001))
* say precisely which two runs can meet on one release ([7301dba](https://github.com/stavarengo/folia-kanban/commit/7301dba415b1c7f604b6978d2515f592cd285657))
* say which job is serialised, not which run ([9e55155](https://github.com/stavarengo/folia-kanban/commit/9e551554c7d56a4a13fbe4b2ce33a4bba067fcc4))

### Build & Tooling

* draft an existing release while its assets are swapped ([81ffc3d](https://github.com/stavarengo/folia-kanban/commit/81ffc3d5c8c14428e11c343147caa64a889f22c9))
* drop the announce job ([ac45eff](https://github.com/stavarengo/folia-kanban/commit/ac45eff9019fbd4cb57deb6e4e84464ab636555d))
* harden the pipeline against what review found ([ccdabab](https://github.com/stavarengo/folia-kanban/commit/ccdababc45bd64a9333486c337a3574ba5841124))
* keep the push token out of the install step ([509fa6b](https://github.com/stavarengo/folia-kanban/commit/509fa6bad3b00d5eaf10d3a5751abad38577ef86))
* mint the release token with the app's client id ([984121e](https://github.com/stavarengo/folia-kanban/commit/984121ec2cea0985dcb6e11ffd728ae612c88325))
* pin the actions, and treat commit subjects as untrusted input ([73ce8f7](https://github.com/stavarengo/folia-kanban/commit/73ce8f7e6465349124903c665e5e53d37d3624a9))
* push the release with a GitHub App when one is configured ([879d259](https://github.com/stavarengo/folia-kanban/commit/879d259fc9383763c8e007c6e8aefe0308237d5a))
* release on dispatch only, and review the plan in the run summary ([cc628e6](https://github.com/stavarengo/folia-kanban/commit/cc628e6a4814e6a7c8c50844d7628735fc0ed3cb))
* replace the release workflows with one pipeline ([852fdf0](https://github.com/stavarengo/folia-kanban/commit/852fdf029231000376dfde959ca6a4399a30741e))
* say what the release groups actually hold apart ([2b26345](https://github.com/stavarengo/folia-kanban/commit/2b26345b7f395c47fe1def658fb4979e200b58f7))
* stop the approval gate from holding up main, and bind a republish to its tag ([438bd86](https://github.com/stavarengo/folia-kanban/commit/438bd8644ebf0be6528e39a98777bb25d8e73456))
* take the push token back out after release-it has used it ([0e66045](https://github.com/stavarengo/folia-kanban/commit/0e66045a9a6ca0441eade6ecaaa80de5109bd107))

## [0.2.0](https://github.com/stavarengo/folia-kanban/compare/0.1.0...0.2.0) (2026-09-10)

### ⚠ BREAKING CHANGES

* **mcp:** add_comment now requires an `author` argument. A client calling it without one gets a schema error, so every caller has to pass the name its comments should be signed with.

### Features

* **mcp:** sign an agent's comment with the name the agent gives ([969958a](https://github.com/stavarengo/folia-kanban/commit/969958a651514315bb8577e63e13e6229b6f3d35))

### Documentation

* **backlog:** file the lint and dependency findings, and the hook decision ([f1ae54f](https://github.com/stavarengo/folia-kanban/commit/f1ae54fecbabf1250bfe2a2727e7b1e2c3e82774))
* **backlog:** file the release-path and verify-chain findings ([8be3445](https://github.com/stavarengo/folia-kanban/commit/8be344552baea37f1b2a7a9236e74d4fc81c464c))

## [0.1.0](https://github.com/stavarengo/folia-kanban/compare/0.0.20...0.1.0) (2026-09-10)

### ⚠ BREAKING CHANGES

* **board:** a [#tag](https://github.com/stavarengo/folia-kanban/issues/tag) in a card note's body counts as one of the card's tags, so existing tag: filters, filter lanes and searches match cards they did not match before.
* a card that no column draws is reported by get_card in no column, where it used to name the fallback one. An assignee:me rule with no Your name set warns instead of refusing every drop.
* **card:** a checklist line with any character but a space in its box, such as [/] or [-], now counts as done; subtask counts and progress bars on existing notes change, and ticking such a line leaves its character as it is.
* **mcp:** a checklist-line card has a ref of its own instead of its parent's file name; re-read the board before reusing stored refs. update_card refuses title and folia-board in properties.
* **mcp:** a description opening with a "#" heading is refused by create_card, update_card and the detail panel. A 504 now means the call is still running; do not retry it.
* a lane is judged against the card as it will be after the write, so some moves previously refused succeed and some previously allowed are refused. get_card answers with the column that draws the card, not its raw status.
* **cards:** assignee is now a key Folia Kanban owns on a card note. A board whose relations list names assignee loses that relationship type, and the detail panel edits the key through its own field rather than as a generic property row.
* **mcp:** create_card and update_card refuse a description containing "## Subtasks", "## Comments" or "## History"; add_subtask and add_comment refuse a line break. get_card reports the column whose tile draws the card. A call still running after a minute is answered 504.
* **settings:** data.json holds only the settings that were set, stamped settingsFormat: 2, and an existing file is pruned on the next write. A stored value equal to the current default is no longer distinguishable from one never chosen, so a later change of default reaches it.
* deleting a column rehomes its cards to the nearest column that is not a lane. The detail panel's add-card flow refuses a lane. get_card reports the lane that draws a card rather than the one its status names.
* get_card reports a nested subcard's column from the tile that draws it. Ticking a parent's checklist box no longer moves the child note to the done column.
* hold a checklist line to the same lane rule a card is held to
* links between cards resolve through Obsidian's link index instead of by bare file name, so where two notes share a basename a subcard or relationship link may bind to a different note than before.
* **mcp:** manifest.json sets isDesktopOnly: true and raises minAppVersion to 1.11.4, so the plugin no longer installs on mobile or on Obsidian below 1.11.4. The MCP token moves from data.json into App.secretStorage; an existing token is migrated once and the mcpToken key removed, and it no longer travels with the vault, so a second install of the same vault gets its own token.
* refuse a drop into a lane the card does not match, and draw the cards already stranded
* **mcp:** refuse a lane an agent's card does not match, and report a lane as drawn
* **mcp:** refuse a list only on the one key it would break
* **cards:** set_subtask_done requires text, the subtask's words exactly as get_card reports them, alongside index; a call with only index is rejected. In the detail panel, a subtask or comment edit is refused when the line no longer reads as it did when the panel loaded.
* the detail panel's Status field and per-subtask column picker refuse a filter-lane column.
* **mcp:** tools/list replaces readOnly with an annotations object (readOnlyHint, destructiveHint, openWorldHint). due must be YYYY-MM-DD. An empty string in properties no longer clears a key; send null. A request with "id": null gets a reply instead of being treated as a notification.
* **mcp:** update_card's properties refuse relationship keys, both ends of every type. get_board reports a filter column as a lane it cannot resolve instead of listing its status bucket.

### Features

* **cards:** say who is working on a card ([11e517e](https://github.com/stavarengo/folia-kanban/commit/11e517e27f213090609426382dde90489696384a))
* **detail:** name the file, name the override, and explain the title they produce ([b756a18](https://github.com/stavarengo/folia-kanban/commit/b756a182c32860ea6bed60bfb89fd2b3bcade9e4))
* **detail:** suggest property names from one key vocabulary ([3578b6d](https://github.com/stavarengo/folia-kanban/commit/3578b6d58cbdbc97297f934c28a5b0beb1fcb8cb))
* **mcp:** keep the agent token out of the vault, and drop the mobile claim ([8e093a5](https://github.com/stavarengo/folia-kanban/commit/8e093a5374709499910e0d66b0b933ccf8b2af2d))
* **mcp:** let agents drive a board through the plugin instead of around it ([716022e](https://github.com/stavarengo/folia-kanban/commit/716022e0d9de2f795dad6f5462b66da03c7a3219))
* **mcp:** let the user choose where the server can be reached from ([7a43b58](https://github.com/stavarengo/folia-kanban/commit/7a43b58cee7a37e3c80f0ae769ad1e5e98732f3c))
* **mcp:** let update_card write list-valued properties ([aaced1e](https://github.com/stavarengo/folia-kanban/commit/aaced1ead7677035f41df36fb569b7258a6af238))
* **mcp:** report a card's assignee when a board is read ([bd31232](https://github.com/stavarengo/folia-kanban/commit/bd312321240d2642e6e6ad8b8f49e4640a834427))
* **settings:** give the settings tab sections instead of one flat list ([85c32d2](https://github.com/stavarengo/folia-kanban/commit/85c32d2b0e2e1cd3e017f32e969601246a897d26))
* **settings:** store only what was actually set ([cd28fb2](https://github.com/stavarengo/folia-kanban/commit/cd28fb2d04adb9f49496a8faf1ba04015a9a0021))

### Bug Fixes

* answer for a nested card from the tile that shows it, and guard the last write path ([09cb449](https://github.com/stavarengo/folia-kanban/commit/09cb449e16a7cd2f32a54639982bf31705e85ec5))
* **audit:** clearer FAIL/OK wording and CLI-level tests for the ratchet ([8d4ae6e](https://github.com/stavarengo/folia-kanban/commit/8d4ae6e463711e92a05b466fb2a914415694baf3))
* **audit:** count raw-value occurrences per file instead of once ([00101a1](https://github.com/stavarengo/folia-kanban/commit/00101a18e095e5467565012a3ebad19ec1bcf8a9))
* **audit:** validate allowlist counts and remove the AUDIT_ROOT bypass ([8546a32](https://github.com/stavarengo/folia-kanban/commit/8546a32253f0906b1e752977135cc74124f7c9c7))
* bind and write wikilinks the way the vault does ([bbbe459](https://github.com/stavarengo/folia-kanban/commit/bbbe459699bf398d69fbb835ce70687f2f109298))
* **board:** address review findings on the filter-lift ([486087e](https://github.com/stavarengo/folia-kanban/commit/486087e06be675942c5ac49def7bc0c760e26aec))
* **board:** count a tag written in a card's body as one of its tags ([5367bf3](https://github.com/stavarengo/folia-kanban/commit/5367bf3b8e995f39eea741e0a00e412851ee392f))
* **board:** don't count a lane-only nested match in the search tally ([d49939f](https://github.com/stavarengo/folia-kanban/commit/d49939fd1cce5c819ca87fad3607b3aac1239659))
* **board:** reload when a card's cache entry catches up ([54b79fe](https://github.com/stavarengo/folia-kanban/commit/54b79fee82dbf26aece807145d0cd0c1af3abca9))
* **board:** stop crediting a match no column will draw ([b1dfc97](https://github.com/stavarengo/folia-kanban/commit/b1dfc971173d0d47f62ef7c1375154d0a1d0b8d5))
* **board:** stop the search tally counting matches a collapse hides ([6007ec9](https://github.com/stavarengo/folia-kanban/commit/6007ec9be63ae3d7671c22bdda4003e4691d2562))
* **board:** surface a matching nested subcard under a filter ([9c0083c](https://github.com/stavarengo/folia-kanban/commit/9c0083c5bc2a0d54f7a90836005d928c29b3ee4a))
* **build:** lower the dynamic import so the MCP server can load Node's http ([6e7e118](https://github.com/stavarengo/folia-kanban/commit/6e7e1181b6f4a78b6b5892f92b5f5b6012ec997b))
* **card:** keep the grab cursor off a tile that cannot be dragged ([549a3b9](https://github.com/stavarengo/folia-kanban/commit/549a3b9137e8cb3caef250f6f633c52a36f90efe))
* **card:** never leave a dangling bare CR when splicing CRLF lines ([db5eee0](https://github.com/stavarengo/folia-kanban/commit/db5eee08371fefa964c8f66b472509abbb5bc98f))
* **card:** parse and write checklist lines correctly on CRLF notes ([179df5a](https://github.com/stavarengo/folia-kanban/commit/179df5ac631a1f757e2d497d3a4a95fa430f2379))
* **card:** parse and write checklist lines correctly on CRLF notes ([7acf774](https://github.com/stavarengo/folia-kanban/commit/7acf774023fc6b2942561107e2d5e1b0b390fed8))
* **card:** read any non-space checkbox character as done ([cb6b321](https://github.com/stavarengo/folia-kanban/commit/cb6b321c6e9f0c68b4d0e590479eed1379c25b9e))
* **cards:** add or drop only your own name on a shared card ([97af4b9](https://github.com/stavarengo/folia-kanban/commit/97af4b9afcb6d4882d069c7349e87916f074cbc0))
* **cards:** keep a tick and its claim naming one line ([7717fd4](https://github.com/stavarengo/folia-kanban/commit/7717fd4183961cb8b36e57951c91574c37fa8f4f))
* **cards:** keep an assignee list a list, and say what a tool cannot write ([5870f7c](https://github.com/stavarengo/folia-kanban/commit/5870f7c42ec54204585a120cb77af9d11cd061f0))
* **cards:** let a board that is merely behind stay out of the way ([bb45c2c](https://github.com/stavarengo/folia-kanban/commit/bb45c2c9f9c12980fa7dd644b64cfd05ca3f9fb9))
* **cards:** name a line by its words before writing to it ([c5fe748](https://github.com/stavarengo/folia-kanban/commit/c5fe748fbe06f9d0daaea877fae57f86d0c53a9a))
* **cards:** read a line's claim off the line, not off the board ([7941841](https://github.com/stavarengo/folia-kanban/commit/79418419a91013c8ab8123aaff86d3705f290112))
* **cards:** settle a disagreed line before either half is written ([711d69f](https://github.com/stavarengo/folia-kanban/commit/711d69fd8ad660a2ec9003757150a68fc7fbd0e5))
* **card:** updateTimestampedLine needs joinLines too ([909bb00](https://github.com/stavarengo/folia-kanban/commit/909bb00c77aa8e38c778731ad847554e2ea91b61))
* close the three write paths that still filed a card into a lane ([e2c8360](https://github.com/stavarengo/folia-kanban/commit/e2c83605bc2d0b9a033f5c032992b01d59008c95))
* **detail:** give the panel an answer for a title wider than it is ([92f61b6](https://github.com/stavarengo/folia-kanban/commit/92f61b668488fc77d19334bd1ded5c7c0bd9fe99))
* **detail:** keep the open panel across a rename of its own note ([aac41cf](https://github.com/stavarengo/folia-kanban/commit/aac41cf5322996423c6329199f5581a7b472d91b))
* **detail:** lay a property suggestion out the way Obsidian lays its own ([c959c74](https://github.com/stavarengo/folia-kanban/commit/c959c74f1ba0a8d7412e6a37d991e808d2d1e218))
* **detail:** leave the field for its own button without saving ([8a8c6f2](https://github.com/stavarengo/folia-kanban/commit/8a8c6f2021c9c77c4eb279aaf085984953b7b26c))
* **detail:** let the resulting-title row wrap and clamp for real ([8936856](https://github.com/stavarengo/folia-kanban/commit/89368563d98e6c1f44f64ba0962e4149f7af58ea))
* **detail:** scope the panel's drafts to the card they were typed on ([65b3b9b](https://github.com/stavarengo/folia-kanban/commit/65b3b9bc3cec961f8d25da13af36cd9dbf5fe926))
* **detail:** stop a half-typed name racing the assign button ([380abd2](https://github.com/stavarengo/folia-kanban/commit/380abd2ac1c68b586cf0e8daa60a254082d924a3))
* **detail:** stop the panel from losing drafts and renaming a file twice ([dca8ae4](https://github.com/stavarengo/folia-kanban/commit/dca8ae46005b8aba0099919c5608b3a5c6d388b7))
* **ds:** let a link wrap, and a refinement out-rank the rule it refines ([b21775e](https://github.com/stavarengo/folia-kanban/commit/b21775eac316a76482ef1cae831d16bb97fc2ff7))
* **ds:** let the guard see the collision on any tag, not only on buttons ([b305d91](https://github.com/stavarengo/folia-kanban/commit/b305d91320749a97cd69fd7b3b959b0b953c3e5a))
* **ds:** make the portal guard see the rung, not just the scope ([b7c0df3](https://github.com/stavarengo/folia-kanban/commit/b7c0df3b758000115ee40eb7b2766a9127db16f2))
* **ds:** put the portalled surfaces on Obsidian's layer scale ([2a1ce18](https://github.com/stavarengo/folia-kanban/commit/2a1ce182fcc63b14c5b1f30cf1446a8c76031086))
* **ds:** read every tag the plugin writes, not a list of the ones it wrote ([c7b7211](https://github.com/stavarengo/folia-kanban/commit/c7b7211a1966c031d9704efbaf909af81f13d7e8))
* hold a checklist line to the same lane rule a card is held to ([bfeb9ea](https://github.com/stavarengo/folia-kanban/commit/bfeb9ea3826ea246b9271b8345e31364902ad27f))
* judge a lane against the card the write will leave behind ([dfca2a1](https://github.com/stavarengo/folia-kanban/commit/dfca2a152a20f9560675022675525ef54163fa9e))
* keep a hovered link and a middle-clicked menu item honest ([7da4918](https://github.com/stavarengo/folia-kanban/commit/7da4918a2dc4875c0c4217e2194948b824bb315e))
* let the middle button reach the button it was aimed at ([c60eed0](https://github.com/stavarengo/folia-kanban/commit/c60eed0d614a4cb3bdc2b5527acd745ef288369b))
* let the tally ask the model, and guard the panel's own column fields ([bb84dc4](https://github.com/stavarengo/folia-kanban/commit/bb84dc492a58a421cc94ecf7d707f41c0c7b78bd))
* **mcp:** apply the held address to the write that restarts the server ([2240610](https://github.com/stavarengo/folia-kanban/commit/2240610de262be35599b579ca66792436a0960c5))
* **mcp:** close the gaps a first review found in the agent server ([0f22cc0](https://github.com/stavarengo/folia-kanban/commit/0f22cc0b31963959ba962bf91df8c16137e1ec49))
* **mcp:** close the ways a bind address could mean two things ([ce296b1](https://github.com/stavarengo/folia-kanban/commit/ce296b135a7409f502b9e12e28c2e5b5a1cda453))
* **mcp:** keep the address the user typed meaning what they typed ([c0e8ac2](https://github.com/stavarengo/folia-kanban/commit/c0e8ac2f1c872729e1699ab0c5413b0ed5065e9f))
* **mcp:** keep the agent's write worth the same as a person's ([42618ed](https://github.com/stavarengo/folia-kanban/commit/42618ed8511bb182ee2a54ad1ea73913909b8bda))
* **mcp:** keep the one-call-at-a-time promise while still freeing the client ([df0ddf8](https://github.com/stavarengo/folia-kanban/commit/df0ddf8327ec1fa7ebf31acdc20df64735d2ba11))
* **mcp:** let a machine with no secure storage lose agent access, not the plugin ([8f14fe2](https://github.com/stavarengo/folia-kanban/commit/8f14fe2fecf83839c739fe2da2d5b7453272ed7b))
* **mcp:** let add_subtask name its line the way the tick expects ([d43e870](https://github.com/stavarengo/folia-kanban/commit/d43e870b954bc466cda9ab7355362b71f352c016))
* **mcp:** make one address have one spelling, and one write ([ae6999a](https://github.com/stavarengo/folia-kanban/commit/ae6999ad075d1df86e58d8180dbcec22cd420e70))
* **mcp:** refuse a lane an agent's card does not match, and report a lane as drawn ([37bd98d](https://github.com/stavarengo/folia-kanban/commit/37bd98df4be9af4a83462505529ab933c2d8e34a))
* **mcp:** refuse a list only on the one key it would break ([2c8d0bd](https://github.com/stavarengo/folia-kanban/commit/2c8d0bdd5e537a55a5d5540b303ed1a5d43e73d2))
* **mcp:** stop an agent writing the board's own record through the tools ([3fff163](https://github.com/stavarengo/folia-kanban/commit/3fff16386789a062159a937cf78a55e6839053c9))
* **mcp:** stop the bind address claiming more than it delivers ([d8c0b6c](https://github.com/stavarengo/folia-kanban/commit/d8c0b6c881072a22135e444afc28549865020a54))
* **mcp:** stop the tools misreporting writes that actually happened ([1e11c5c](https://github.com/stavarengo/folia-kanban/commit/1e11c5c5e36904a0558e3f7ad42571cc64a75079))
* one rule for what draws a card, and stop a refusal being reported as success ([f4452bd](https://github.com/stavarengo/folia-kanban/commit/f4452bdc77e2f2eb2f60b30994bcb04572765209))
* open a card note the way Obsidian opens a link ([51329ec](https://github.com/stavarengo/folia-kanban/commit/51329ec8d439eaaa9eef928b3c936ca5b6554807))
* refuse a drop into a lane the card does not match, and draw the cards already stranded ([97c385d](https://github.com/stavarengo/folia-kanban/commit/97c385d570638516d38be6931ad40997edb3c452))
* **settings:** ask whether a changed key is a row, not whether every object has it ([72f1829](https://github.com/stavarengo/folia-kanban/commit/72f182968ebf1a06dd36c8544badbcec352ebce9))
* **settings:** batch the port and address when focus moves between them ([421c661](https://github.com/stavarengo/folia-kanban/commit/421c661749d712e8b561fab4a84e224fd438d922))
* **settings:** commit a held MCP field whenever it is left ([6a0f29b](https://github.com/stavarengo/folia-kanban/commit/6a0f29b7f58ca29a30bd9073c46945f20ae362a8))
* **settings:** give the held MCP fields a blur on both tab renderings ([79319a4](https://github.com/stavarengo/folia-kanban/commit/79319a416309e6b50002ecc1841b759aed6c37a9))
* **settings:** give the version row a heading it can belong to ([5979128](https://github.com/stavarengo/folia-kanban/commit/59791289c2861a4bfa3599f1e79dcee6037e0a91))
* **settings:** ignore a held field's input once it leaves the screen ([e33cf4b](https://github.com/stavarengo/folia-kanban/commit/e33cf4bfa1e1f43325455bbdb331180ec1e3f07e))
* **settings:** keep an open settings tab from undoing an external change ([8720d57](https://github.com/stavarengo/folia-kanban/commit/8720d57839da9f8bdea6f3e36d9d285df165afda))
* **settings:** keep the bind-address field telling the truth ([fb7057d](https://github.com/stavarengo/folia-kanban/commit/fb7057d68110c601d80c469252144c8a91bede26))
* **settings:** keep the running settings when data.json cannot be read ([c265090](https://github.com/stavarengo/folia-kanban/commit/c265090e1941718588caaecf761b7757a24a4001))
* **settings:** let the name setting say it also assigns cards ([d10fc25](https://github.com/stavarengo/folia-kanban/commit/d10fc2585074daae30991033f9eef9010c515b7c))
* **settings:** read data.json when Sync or a hand-edit changes it ([763572f](https://github.com/stavarengo/folia-kanban/commit/763572ff125188c120f5bab30ac1f5abb2fd03ef))
* **settings:** redraw the settings tab the way 1.13 owns it, and only when it matters ([bdd6c60](https://github.com/stavarengo/folia-kanban/commit/bdd6c6030092c34925acbb0bf435bd21f560fc79))
* **settings:** stop greying a side-panel width that is still in use ([35267f7](https://github.com/stavarengo/folia-kanban/commit/35267f763c04298c0a60663c6e0554f08b53f52b))
* **settings:** stop promising a board opens from everywhere ([8810c4d](https://github.com/stavarengo/folia-kanban/commit/8810c4d801caab24a2a80edeae3c22ef709adf32))
* **settings:** stop the tab committing an address typed over ([b05df5e](https://github.com/stavarengo/folia-kanban/commit/b05df5e88ec580bf5fec40c56ae605b219f89a0f))
* **settings:** tell a data.json with no token key from one whose key is empty ([18e2ef6](https://github.com/stavarengo/folia-kanban/commit/18e2ef64055cafac73c2a14020cabe96ea60a225))
* **settings:** tell the reader why the agent-access fields are greyed ([8b9b98a](https://github.com/stavarengo/folia-kanban/commit/8b9b98a874b99dd1b6c3369e85d7a58303ff2bf3))
* tell a middle drag from a middle click on the board ([12b2a8e](https://github.com/stavarengo/folia-kanban/commit/12b2a8ecc1d418ef61a75bf2adc9be4aca25baff))
* **ui:** drop stale board reads that resolve out of order ([528284b](https://github.com/stavarengo/folia-kanban/commit/528284b68fb5278ec5b89f5f949c07914d4992fd))
* **ui:** follow the board to another window when its tab is moved there ([18d4aa4](https://github.com/stavarengo/folia-kanban/commit/18d4aa48033bf1275983af4538a7278f837a4083))
* **ui:** give the board's chrome its own leaf to listen to ([fb7a12a](https://github.com/stavarengo/folia-kanban/commit/fb7a12a18cc0a31eda117a9bebbc3a1bae8f7954))
* **ui:** let go of the shortcut when the board's chrome goes away ([7348841](https://github.com/stavarengo/folia-kanban/commit/734884168737690eceb38eb3a4d065ccf66d91d0))
* **ui:** measure the preview only once the board it belongs to is mounted ([05641c4](https://github.com/stavarengo/folia-kanban/commit/05641c4450a062cfeeeb3cc276d9b437d75aa692))
* **ui:** notice the move itself, not the resize that usually comes with it ([77c408c](https://github.com/stavarengo/folia-kanban/commit/77c408c61c9128cd8eb4912239435961fc963647))
* **ui:** open menus and modals in the board's own window ([1719109](https://github.com/stavarengo/folia-kanban/commit/1719109b15fc0f368f010d062d6c406cf62a0f86))
* **ui:** remember only the priority the user picked ([d8e8c28](https://github.com/stavarengo/folia-kanban/commit/d8e8c28d5213e892ee9e1391e52227351fbd92f5))
* **ui:** reserve room for the status bar the board's own window has ([dbec9b3](https://github.com/stavarengo/folia-kanban/commit/dbec9b37dd29a0c2e072284aa40b355a1a923d1e))
* **ui:** stop the shortcut swallowing keys it cannot use, and watch the panel too ([0939004](https://github.com/stavarengo/folia-kanban/commit/09390043f08a3f0e34ea4507d937b957c9b9fe71))
* **view:** claim only the keys that type a slash, not every slash there is ([65f3648](https://github.com/stavarengo/folia-kanban/commit/65f3648f50f1b125d6049fe0158e01cf7131831e))
* **view:** claim the slash only while the board can use it ([8651118](https://github.com/stavarengo/folia-kanban/commit/8651118eb0a58aea853ac020bbc03032c88cf0dc))

### Refactoring

* **board:** let one helper decide what a filter actually shows ([fcfa9a7](https://github.com/stavarengo/folia-kanban/commit/fcfa9a73e8dbd7576891c6002d99cd98cba9340b))
* keep the vault adapter's App to itself ([352fcae](https://github.com/stavarengo/folia-kanban/commit/352fcae7a439893143ad32360a31498f5934027b))
* **mcp:** decide the token in one pure place, and stop leaving it in the settings ([d048570](https://github.com/stavarengo/folia-kanban/commit/d0485705072ae6b4ebf65f0c7220657556d5af4d))
* **model:** move the card-move composition below the repository port ([e943a30](https://github.com/stavarengo/folia-kanban/commit/e943a305c449c63588f55d6e774d26ae1a86ef05))
* move the filter grammar below the CardRepository port ([4da057f](https://github.com/stavarengo/folia-kanban/commit/4da057f9160985e12b7204cfcf8ce50614d6545a))
* return early from laneVerdict when the column is plain ([fb9029d](https://github.com/stavarengo/folia-kanban/commit/fb9029d009187e7a431f072d62419e90f7b2308f))

### Documentation

* **agents:** note that Obsidian 1.13 settings is its own CDP page ([c259d17](https://github.com/stavarengo/folia-kanban/commit/c259d17f858640f4259c817905179aaac39e388c))
* audit what Obsidian already provides ([c5f07f6](https://github.com/stavarengo/folia-kanban/commit/c5f07f68b491312896b8cb72ba228583d5909936))
* **audit:** record that 06-05's replacement variable is not one Obsidian has ([e870f9a](https://github.com/stavarengo/folia-kanban/commit/e870f9a6599043f0e33de9d82a49efd52eb57910))
* **backlog:** audit in-house work Obsidian already provides ([78b1b54](https://github.com/stavarengo/folia-kanban/commit/78b1b54d1e378225e651812f9d185dbb66461e5e))
* **backlog:** close the entry for the board that listened to the window ([86d5f8b](https://github.com/stavarengo/folia-kanban/commit/86d5f8bacbbe5e46a7cfd22d69b39e6a0904acc9))
* **backlog:** close the stale line index entry ([54d8f91](https://github.com/stavarengo/folia-kanban/commit/54d8f913f61c83fb988445076cab5843b15451a1))
* **backlog:** close the two lane entries the fix answers ([e882102](https://github.com/stavarengo/folia-kanban/commit/e882102a60c5131a247fc17ade71e6fe2cdeb922))
* **backlog:** confirm the community portal warning closed on 0.0.20 ([08f3b07](https://github.com/stavarengo/folia-kanban/commit/08f3b0770da2f866ce6040b8abf2175a90341775))
* **backlog:** declare the decision-pending entries as blocked so the board shows them ([9ea1486](https://github.com/stavarengo/folia-kanban/commit/9ea1486d15603ac53e6a528bc28c39feedf81e72))
* **backlog:** drop the fixed out-of-order board load entry ([6d41d26](https://github.com/stavarengo/folia-kanban/commit/6d41d2693b40f9575f6073df27b1c3da0f7188f9))
* **backlog:** drop the two specificity entries their fix closes ([bd154c5](https://github.com/stavarengo/folia-kanban/commit/bd154c5a3257450a3d228e9879ed8e82150ec6e4))
* **backlog:** drop the verified detail-drafts entry ([c4ba08a](https://github.com/stavarengo/folia-kanban/commit/c4ba08a0537246ce6fd5e78b7143e7ee4e725449))
* **backlog:** drop the verified nested-subcard-filter entry ([e29de18](https://github.com/stavarengo/folia-kanban/commit/e29de18cbd37505004c450156d43cadbc1ead84b))
* **backlog:** drop the verified rename-drafts entry ([33e36b2](https://github.com/stavarengo/folia-kanban/commit/33e36b20ff472af09fd382e64ddad2176f6c213b))
* **backlog:** drop the verified title-fields entry ([950ec26](https://github.com/stavarengo/folia-kanban/commit/950ec2698aadf8d1e2b3ac8e73da8e2f48136428))
* **backlog:** drop the verified title-overflow entry ([a6da58a](https://github.com/stavarengo/folia-kanban/commit/a6da58a1404797b441327eea2a5acbc0ae1099f7))
* **backlog:** flag the six entries that wait on a product decision ([b6a6cda](https://github.com/stavarengo/folia-kanban/commit/b6a6cdaf3d635bc4ef56c9a0f895ec16f2c263b8))
* **backlog:** fold the bind-address setting into the MCP entry as a prerequisite ([debc1fa](https://github.com/stavarengo/folia-kanban/commit/debc1fa28d1c793de769f6d129ecbe8fcf5f811a))
* **backlog:** give the lane-membership entry an id of its own ([69119c9](https://github.com/stavarengo/folia-kanban/commit/69119c9664443373b4474138b6856bd7f56f9c64))
* **backlog:** name the commits the bind-address work actually landed in ([7a92f5a](https://github.com/stavarengo/folia-kanban/commit/7a92f5a6b20f4678263e1e12c6bdcbee0873e382))
* **backlog:** note override-title commit rewrites frontmatter tags shape ([c83dc53](https://github.com/stavarengo/folia-kanban/commit/c83dc5399d89b69a4fcbc433d665e776a5ac1f53))
* **backlog:** note that a second install gets its own agent token, silently ([4b9a383](https://github.com/stavarengo/folia-kanban/commit/4b9a3836e657d3a1d4f78370d8ae13e0118a4eb3))
* **backlog:** note the claim a stale click can overwrite ([4adb370](https://github.com/stavarengo/folia-kanban/commit/4adb370b9b76312561cb79306e23644a7c36edeb))
* **backlog:** note the column picker that can quietly do nothing ([3e34e32](https://github.com/stavarengo/folia-kanban/commit/3e34e32f1347ac05db2a789a05f284d30def1bf7))
* **backlog:** note the panel suggests in two different ways ([689ce7d](https://github.com/stavarengo/folia-kanban/commit/689ce7d56acf42800bfcc6b2de1434a0cc6be44a))
* **backlog:** note the title row was measured on the built plugin ([4bb7522](https://github.com/stavarengo/folia-kanban/commit/4bb7522786f2fc3e452394be43364ec02d78cb46))
* **backlog:** point the lane cross-reference at its new home ([630eda2](https://github.com/stavarengo/folia-kanban/commit/630eda20b3cfcdc19e38e9981985f1d31408a3e1))
* **backlog:** put the inferred-name entry on hold ([a3b3587](https://github.com/stavarengo/folia-kanban/commit/a3b3587d4d18d438b47fa056d31488f5172fd487))
* **backlog:** reconnect the lane entries after the nested-subcard fix ([9738d6a](https://github.com/stavarengo/folia-kanban/commit/9738d6a2e6f0b12a2e0dfd60b72e569f6a9c7763))
* **backlog:** record the decisions on the five flagged entries and close the setup race ([f99751a](https://github.com/stavarengo/folia-kanban/commit/f99751af189ac11aed566c488e370e1c884b768e))
* **backlog:** record that 0.0.20 is the release the portal rescan waits for ([047c8f1](https://github.com/stavarengo/folia-kanban/commit/047c8f110caf68cff9cdf0e90658ab8be3f27d4c))
* **backlog:** record that board reads can land out of order ([517d098](https://github.com/stavarengo/folia-kanban/commit/517d098db6cfb908d868b7df8f0e9a9ecd2c1dda))
* **backlog:** record the bind-address setting on the MCP entry ([ce84c49](https://github.com/stavarengo/folia-kanban/commit/ce84c4942086210ebfd1c150cc970cf34972be85))
* **backlog:** record the execution order of the remaining entries ([4426382](https://github.com/stavarengo/folia-kanban/commit/4426382e3174b519f1f139a13729665241a227fa))
* **backlog:** record the held-field batching defect and its fix ([a4cb5b1](https://github.com/stavarengo/folia-kanban/commit/a4cb5b188984a236ed64ca6a3167e00232e2b75e))
* **backlog:** record the live proof of the held-field fix ([6c5664f](https://github.com/stavarengo/folia-kanban/commit/6c5664f76d5360671c1580e3cbaefec064017406))
* **backlog:** record the untested settings tab below Obsidian 1.13 ([a7022b1](https://github.com/stavarengo/folia-kanban/commit/a7022b12116f479a80d35e21ac66792b28401c73))
* **backlog:** record what the title row failed on and what it left behind ([6cafc64](https://github.com/stavarengo/folia-kanban/commit/6cafc64edac0241cad57df82b57b26fd439a09bc))
* **backlog:** renumber the filter-lane entry past a taken id ([5e985ae](https://github.com/stavarengo/folia-kanban/commit/5e985ae8832841c1cb7b0cbcb287c09f2cea61f8))
* **backlog:** renumber the two lane entries off a taken slug ([93195fa](https://github.com/stavarengo/folia-kanban/commit/93195faebb67b03217a8498be93f4cea7d7e03bf))
* **backlog:** renumber the view-adapter entry off a taken slug ([29eb240](https://github.com/stavarengo/folia-kanban/commit/29eb2407ae9945cdfcd38e540e80aaa7e420cd2a))
* **backlog:** reopen six entries pending live verification in Obsidian ([da5daf5](https://github.com/stavarengo/folia-kanban/commit/da5daf5018e5d6720b0a75d253e31fb198cc33ba))
* **backlog:** require a user-facing bind-address setting for the MCP server ([b020873](https://github.com/stavarengo/folia-kanban/commit/b02087303c214d58cc6b7a48a0b9575e45841d73))
* **backlog:** triage the Obsidian audit findings ([6b1179e](https://github.com/stavarengo/folia-kanban/commit/6b1179e5143522ca4fa3491b98b59a3af4c131b6))
* close the card-open-navigation backlog entry ([394012a](https://github.com/stavarengo/folia-kanban/commit/394012a2af1154a23c48e85da0a272296cf84883))
* **ds:** say how the on-accent colour actually gets picked ([1c4da7f](https://github.com/stavarengo/folia-kanban/commit/1c4da7fdf5ec29bf6e6e7b846e4960d04805c1ca))
* **ds:** say what reading the app's scale costs ([8861d70](https://github.com/stavarengo/folia-kanban/commit/8861d70f51922f4e42eadd5d76b92c23316928b3))
* **ds:** say what the tag scanner reads now that it reads any tag ([eaad1ee](https://github.com/stavarengo/folia-kanban/commit/eaad1ee93d63e5fb523b0978b21239c7ba0d7eab))
* **handover:** flag the MCP entry's new prerequisite and the design items' open call ([2121068](https://github.com/stavarengo/folia-kanban/commit/212106802687b9b5412440c21db5805355b4a34a))
* **handover:** move the file to docs/ai/handovers where its links and the registry expect it ([23f240c](https://github.com/stavarengo/folia-kanban/commit/23f240cbeb2476684b183357f171f06e525ce3b1))
* **handover:** point the next session at the six to verify and the eight to execute ([9d17ef0](https://github.com/stavarengo/folia-kanban/commit/9d17ef0c3a5c7cfae34365a8bf15889ce9e30753))
* **handover:** retire the verify-then-execute handover ([47035da](https://github.com/stavarengo/folia-kanban/commit/47035da43b9a2158b5401eb6de35b6f47e8e891d))
* **mcp:** name the history setting the way the tab now does ([8df34a6](https://github.com/stavarengo/folia-kanban/commit/8df34a6a7b01e89161f4babef82b8c0686cd3c3a))
* name the other ways a card can be given a lane's column ([bc2d41f](https://github.com/stavarengo/folia-kanban/commit/bc2d41fd5731957cb41c9eef1c54aee81b215a23))
* **releasing:** keep only what the tooling cannot say ([943493f](https://github.com/stavarengo/folia-kanban/commit/943493fdeab1a7fa49081125803de7a2b081d10c))
* repoint references left by the closed backlog entries ([8e4c475](https://github.com/stavarengo/folia-kanban/commit/8e4c475e5d359a22ab0bc43d0bacb61a626bd986))
* say what the assignee field does to a list of names ([44663ee](https://github.com/stavarengo/folia-kanban/commit/44663ee376161db3a822b2803b0e1dbd0cfc4980))
* say which reading decides a checklist line's kind and its claim ([1fcf397](https://github.com/stavarengo/folia-kanban/commit/1fcf397e6fd05a15e49e8cbeea9a5f105c04fd93))
* say why the popover needs no owner ([cbffe7e](https://github.com/stavarengo/folia-kanban/commit/cbffe7ec3c6a57073b950b6b42952d2d842b7b2b))
* stop listing order changes as something structural adds ([37e560b](https://github.com/stavarengo/folia-kanban/commit/37e560ba7f27a823d23849cd0589e0d6e1dd70a3))
* **waiver:** name the concrete 90px/26px comment-counting gap ([f8d56a7](https://github.com/stavarengo/folia-kanban/commit/f8d56a77363f26dd4cc8d00d92a7a679981377e2))

### Tests

* **board:** pin the search tally to what the board actually draws ([46aa10f](https://github.com/stavarengo/folia-kanban/commit/46aa10f93d3cea8f01fd695dc44ecbfde92907e0))
* **board:** pin the two filter rules nothing was asserting ([c6fea81](https://github.com/stavarengo/folia-kanban/commit/c6fea810b45bcfe58eae8f089350fe9162737d9d))
* **card:** cover an unticked custom checkbox character on CRLF ([33cbfe3](https://github.com/stavarengo/folia-kanban/commit/33cbfe3e431ed53b92cbfc127eef6e8fd2046653))
* **detail:** name the stale-board test for what it actually stages ([06fcde6](https://github.com/stavarengo/folia-kanban/commit/06fcde6565a42e9c60aad2154563ee157d7ed367))
* **mcp:** pin why a reported column cannot follow a subcard cycle ([080e738](https://github.com/stavarengo/folia-kanban/commit/080e73849498d6cb25389049529962c71223a864))
* **ui:** cover a stale load's error against a newer success and vice versa ([bbe5935](https://github.com/stavarengo/folia-kanban/commit/bbe5935896443c5c4dc4c7431f56e8d6b924f02c))
* **ui:** cover the add-card flow's own load being superseded ([34df40e](https://github.com/stavarengo/folia-kanban/commit/34df40e9da45d0b29f6e3dca3573a3b71adad036))
* **ui:** cover the menu's focus lookup, and say what the popout fix left open ([e4b0f18](https://github.com/stavarengo/folia-kanban/commit/e4b0f1871c96616602f2d158ee8ce723cdc1e60a))
* **ui:** cover the side panel's teardown listener in the board's window ([8a463c4](https://github.com/stavarengo/folia-kanban/commit/8a463c4f6c9748870ccb17a06e76144da47e4faa))

### Build & Tooling

* **release:** let the commits choose the version ([4ef79bf](https://github.com/stavarengo/folia-kanban/commit/4ef79bff327ef37c487b7ca98f60bac5ce4be10f))

### Styling

* spell out the menu's middle-click guard ([f7f95e7](https://github.com/stavarengo/folia-kanban/commit/f7f95e733318de407f7adac17da09819b5e42548))

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
