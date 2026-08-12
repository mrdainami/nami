// Nami — vendored brand marks + type glyphs for the code chips.
// Brand paths are from simple-icons (CC0 1.0), fetched once and inlined so the
// app stays fully self-contained. Everything draws in currentColor, so the
// chips keep their paper tints and both themes re-ink the glyphs for free.
// `hermes` is the exception: simple-icons has no mark for it, so the path is a
// potrace of Nous Research's own Hermes app icon (the girl in headphones,
// NousResearch/hermes-agent · apps/desktop/assets/icon.png), cropped to the
// head and traced at chip resolution. Her face is a hole in the path, so the
// chip tint shows through it and the mark re-inks with every other glyph.

const BRAND = {
  anthropic: '<path fill="currentColor" d="M17.304 3.541h-3.672l6.696 16.918H24Zm-10.608 0L0 20.459h3.744l1.37-3.553h7.005l1.369 3.553h3.744L10.536 3.541Zm-.371 10.223L8.616 7.82l2.291 5.945Z"/>',
  claude: '<path fill="currentColor" d="m4.714 15.956 4.718-2.648.079-.23-.08-.128h-.23l-.79-.048-2.695-.073-2.337-.097-2.265-.122-.57-.121-.535-.704.055-.353.48-.321.685.06 1.518.104 2.277.157 1.651.098 2.447.255h.389l.054-.158-.133-.097-.103-.098-2.356-1.596-2.55-1.688-1.336-.972-.722-.491L2 6.223l-.158-1.008.656-.722.88.06.224.061.893.686 1.906 1.476 2.49 1.833.364.304.146-.104.018-.072-.164-.274-1.354-2.446-1.445-2.49-.644-1.032-.17-.619a3 3 0 0 1-.103-.729L6.287.133 6.7 0l.995.134.42.364.619 1.415L9.735 4.14l1.555 3.03.455.898.243.832.09.255h.159V9.01l.127-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.583.28.48.685-.067.444-.286 1.851-.558 2.903-.365 1.942h.213l.243-.242.983-1.306 1.652-2.064.728-.82.85-.904.547-.431h1.032l.759 1.129-.34 1.166-1.063 1.347-.88 1.142-1.263 1.7-.79 1.36.074.11.188-.02 2.853-.606 1.542-.28 1.84-.315.832.388.09.395-.327.807-1.967.486-2.307.462-3.436.813-.043.03.049.061 1.548.146.662.036h1.62l3.018.225.79.522.473.638-.08.485-1.213.62-1.64-.389-3.825-.91-1.31-.329h-.183v.11l1.093 1.068 2.003 1.81 2.508 2.33.127.578-.321.455-.34-.049-2.204-1.657-.85-.747-1.925-1.62h-.127v.17l.443.649 2.343 3.521.122 1.08-.17.353-.607.213-.668-.122-1.372-1.924-1.415-2.168-1.141-1.943-.14.08-.674 7.254-.316.37-.728.28-.607-.461-.322-.747.322-1.476.388-1.924.316-1.53.285-1.9.17-.632-.012-.042-.14.018-1.432 1.967-2.18 2.945-1.724 1.845-.413.164-.716-.37.066-.662.401-.589 2.386-3.036 1.439-1.882.929-1.086-.006-.158h-.055L4.138 18.56l-1.13.146-.485-.456.06-.746.231-.243 1.907-1.312Z"/>',
  openai: '<path fill="currentColor" d="M22.282 9.821a6 6 0 0 0-.516-4.91a6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9a6.05 6.05 0 0 0 .743 7.097a5.98 5.98 0 0 0 .51 4.911a6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206a6 6 0 0 0 3.997-2.9a6.06 6.06 0 0 0-.747-7.073M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081l4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085l4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354l-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667m2.01-3.023l-.141-.085l-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681zm1.097-2.365l2.602-1.5l2.607 1.5v2.999l-2.597 1.5l-2.607-1.5Z"/>',
  gemini: '<path fill="currentColor" d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68q.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58a12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68q-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96q2.19.93 3.81 2.55t2.55 3.81"/>',
  // The Antigravity arch, potraced from Google's own mark (the gradient "A",
  // Dainami-OS/content/brand-assets/logos/antigravity-mark.png) the same way
  // hermes was — solid currentColor, so the chip tints re-ink it per theme.
  antigravity: '<g transform="translate(0 23.04) scale(0.012 -0.012)"><path fill="currentColor" d="M901 1826 c-190 -63 -288 -235 -445 -786 -148 -523 -214 -674 -369 -853 -96 -110 -108 -143 -62 -173 113 -74 333 119 546 477 175 295 268 369 454 357 167 -11 247 -81 410 -358 198 -335 398 -520 521 -480 65 22 56 76 -31 170 -151 164 -224 329 -365 819 -136 475 -194 615 -305 726 -99 101 -235 139 -354 101z"/></g>',
  opencode: '<path fill="currentColor" d="M22 24H2V0h20zM17 4.8H7v14.4h10z"/>',
  hermes: '<g transform="translate(0.000 23.200) scale(0.020000 -0.020000)"><path fill="currentColor" d="M500 1111 l-35 -8 41 -2 c85 -2 180 -73 222 -163 18 -40 68 -58 55 -20 -5 15 -4 15 9 -1 16 -21 65 -20 61 1 -2 6 4 12 12 12 9 0 12 6 8 18 -5 14 -3 15 8 5 20 -20 31 -15 24 10 -7 21 -6 21 10 5 16 -15 17 -21 5 -64 -8 -26 -15 -43 -18 -36 -2 7 -8 10 -13 6 -5 -3 -9 -1 -9 3 0 5 -15 9 -34 9 -24 0 -32 -4 -29 -13 7 -17 -3 -16 -33 3 -33 22 -37 15 -19 -36 8 -24 13 -51 10 -61 -4 -11 1 -22 12 -28 10 -6 14 -10 8 -11 -22 0 -37 18 -33 41 3 26 -17 35 -41 20 -12 -8 -13 -12 -1 -26 10 -12 11 -18 1 -28 -10 -9 -11 -8 -6 6 4 9 3 17 -2 17 -6 0 -15 25 -22 55 -8 35 -18 55 -26 55 -8 0 -22 11 -31 25 -18 27 -40 34 -30 10 7 -20 -23 -35 -51 -24 -22 8 -23 7 -13 -12 16 -28 -1 -45 -44 -43 -61 3 -74 24 -28 46 20 10 27 21 27 41 l-1 28 18 -23 c18 -23 19 -23 33 -4 8 11 15 22 15 25 0 3 12 7 26 8 19 1 30 -7 43 -28 23 -41 43 -47 29 -8 -13 39 -83 110 -130 132 -162 77 -415 -90 -460 -304 -16 -77 -4 -125 42 -171 45 -45 68 -51 44 -10 l-17 27 28 -27 29 -28 -12 -118 c-15 -147 -30 -216 -54 -242 -42 -45 -94 -7 -92 67 2 79 -25 9 -28 -74 -3 -82 13 -114 70 -141 20 -9 39 -20 43 -24 13 -18 94 18 118 52 l24 35 -7 -30 c-4 -16 -15 -38 -23 -47 -15 -17 -9 -18 126 -18 l142 0 -15 22 c-20 28 -20 38 0 38 9 0 29 15 46 34 l30 34 47 -47 c43 -42 46 -48 33 -63 -14 -16 -13 -18 9 -18 14 0 31 6 38 12 11 10 13 10 7 1 -9 -16 -7 -16 40 2 36 15 38 15 19 -1 -19 -16 -18 -16 20 -9 53 10 103 11 140 1 l30 -7 -25 15 c-32 20 -4 20 30 1 14 -8 51 -14 83 -15 l58 0 22 47 c32 72 28 177 -11 329 -17 66 -45 184 -61 262 -71 340 -185 470 -421 478 -47 1 -101 -1 -120 -5z m-335 -211 c-20 -22 -8 -28 14 -7 11 10 13 10 7 0 -4 -7 -2 -13 4 -13 6 0 8 -4 5 -10 -9 -14 9 -12 24 3 10 10 11 8 6 -8 -4 -12 7 -5 29 20 l36 40 -22 -52 c-13 -32 -25 -48 -29 -41 -6 9 -11 9 -23 -1 -9 -8 -16 -10 -16 -5 0 5 -4 4 -8 -2 -4 -6 -23 -9 -44 -6 -48 5 -49 24 -6 69 34 36 53 46 23 13z m195 -31 c0 -34 -3 -39 -13 -30 -8 6 -16 9 -18 7 -2 -2 -17 -6 -32 -10 -26 -6 -28 -4 -25 16 2 13 8 22 13 21 6 0 19 -3 30 -5 13 -2 23 5 30 20 13 30 15 28 15 -19z m68 -5 c3 -18 -1 -20 -28 -16 -22 3 -30 10 -30 24 0 28 54 21 58 -8z m2 -191 c0 -2 -4 -3 -9 -3 -9 0 -41 72 -41 93 1 9 50 -80 50 -90z m-93 -25 c16 3 23 0 19 -7 -10 -15 -6 -14 39 9 28 14 42 17 51 9 7 -6 35 -10 61 -8 113 4 116 -5 78 -225 -14 -80 -25 -174 -25 -209 0 -89 -16 -101 -59 -41 l-32 46 -72 -7 c-84 -8 -86 -7 -137 92 -33 64 -55 173 -32 159 8 -4 10 -2 6 7 -3 8 6 26 20 40 14 15 26 33 26 41 0 17 -32 38 -52 34 -7 -2 -13 4 -13 12 0 8 8 14 17 14 10 -1 15 2 12 7 -3 5 -2 9 3 9 25 1 35 18 23 41 l-13 24 27 -25 c18 -16 36 -24 53 -22z m468 -58 c4 -6 -10 -10 -35 -10 -25 0 -39 4 -35 10 3 6 19 10 35 10 16 0 32 -4 35 -10z m-555 -68 c0 -7 -4 -10 -10 -7 -5 3 -10 16 -10 28 0 18 2 19 10 7 5 -8 10 -21 10 -28z m433 -268 c-30 -23 -32 -16 -9 44 l21 57 3 -43 c2 -33 -1 -47 -15 -58z m391 -24 c1 -41 -5 -64 -23 -93 -30 -49 -33 -45 -15 23 10 34 14 82 11 125 -4 70 -4 70 11 35 8 -19 16 -60 16 -90z m-372 -62 c-20 -23 -39 -23 -52 1 -8 16 -4 23 23 40 l32 20 6 -22 c3 -13 0 -29 -9 -39z m-502 -40 c-37 -71 -144 -76 -180 -9 -16 32 -11 36 10 8 38 -48 132 -39 161 15 6 11 13 17 16 15 2 -3 -1 -16 -7 -29z M388 629 c-10 -5 -15 -16 -12 -24 4 -8 9 -13 14 -10 4 2 12 -7 18 -20 14 -30 42 -33 49 -5 6 21 18 26 28 10 9 -14 -42 -43 -65 -37 -11 3 -20 1 -20 -4 0 -19 60 -8 89 17 34 28 33 37 -7 58 -41 20 -75 26 -94 15z M253 387 c4 -10 7 -25 7 -33 0 -10 6 -11 23 -5 13 5 36 7 53 5 29 -5 29 -5 -5 11 -19 8 -36 13 -39 10 -3 -3 -14 3 -25 12 -20 17 -20 17 -14 0z M1165 167 c0 -63 -4 -79 -27 -115 -34 -51 -34 -52 -3 -52 52 0 83 128 51 205 -8 19 -16 35 -18 35 -2 0 -3 -33 -3 -73z M547 73 c-4 -3 1 -15 10 -26 17 -19 17 -20 -4 -8 -40 21 -57 15 -36 -14 20 -28 35 -33 26 -9 -5 14 -3 15 16 4 29 -15 36 -8 20 22 -7 12 -12 26 -11 31 3 9 -12 9 -21 0z"/></g>',
  kimi: '<path fill="currentColor" d="M21.765.351C22.998.351 24 1.353 24 2.586S22.998 4.82 21.765 4.82h-1.974c-.15 0-.26-.12-.26-.26V2.586A2.237 2.237 0 0 1 21.765.35M9.41 13.388l8.447-8.377c.16-.16.07-.471-.14-.471h-4.55s-.1.02-.14.06l-9.099 9.029c-.14.14-.35.02-.35-.21V4.81c0-.15-.1-.27-.221-.27H.22c-.12 0-.22.12-.22.27v18.57c0 .15.1.27.22.27h3.137c.12 0 .22-.12.22-.27v-3.79c0-.08.03-.16.08-.21l2.826-2.796c.07-.07.16-.08.241-.03l7.546 5.551a8.9 8.9 0 0 0 4.018 1.493c.12.01.23-.11.23-.27V19.76c0-.14-.08-.25-.19-.26a5.8 5.8 0 0 1-2.355-.942l-6.533-4.73c-.14-.09-.15-.32-.03-.441"/>',
  mcp: '<path fill="currentColor" d="M13.85 0a4.16 4.16 0 0 0-2.95 1.217L1.456 10.66a.835.835 0 0 0 0 1.18a.835.835 0 0 0 1.18 0l9.442-9.442a2.49 2.49 0 0 1 3.541 0a2.49 2.49 0 0 1 0 3.541L8.59 12.97l-.1.1a.835.835 0 0 0 0 1.18a.835.835 0 0 0 1.18 0l.1-.098l7.03-7.034a2.49 2.49 0 0 1 3.542 0l.049.05a2.49 2.49 0 0 1 0 3.54l-8.54 8.54a1.96 1.96 0 0 0 0 2.755l1.753 1.753a.835.835 0 0 0 1.18 0a.835.835 0 0 0 0-1.18l-1.753-1.753a.266.266 0 0 1 0-.394l8.54-8.54a4.185 4.185 0 0 0 0-5.9l-.05-.05a4.16 4.16 0 0 0-2.95-1.218c-.2 0-.401.02-.6.048a4.17 4.17 0 0 0-1.17-3.552A4.16 4.16 0 0 0 13.85 0m0 3.333a.84.84 0 0 0-.59.245L6.275 10.56a4.186 4.186 0 0 0 0 5.902a4.186 4.186 0 0 0 5.902 0L19.16 9.48a.835.835 0 0 0 0-1.18a.835.835 0 0 0-1.18 0l-6.985 6.984a2.49 2.49 0 0 1-3.54 0a2.49 2.49 0 0 1 0-3.54l6.983-6.985a.835.835 0 0 0 0-1.18a.84.84 0 0 0-.59-.245"/>',
  ollama: '<path fill="currentColor" d="M16.361 10.26a.9.9 0 0 0-.558.47l-.072.148l.001.207c0 .193.004.217.059.353c.076.193.152.312.291.448c.24.238.51.3.872.205a.86.86 0 0 0 .517-.436a.75.75 0 0 0 .08-.498c-.064-.453-.33-.782-.724-.897a1.1 1.1 0 0 0-.466 0m-9.203.005c-.305.096-.533.32-.65.639a1.2 1.2 0 0 0-.06.52c.057.309.31.59.598.667c.362.095.632.033.872-.205c.14-.136.215-.255.291-.448c.055-.136.059-.16.059-.353l.001-.207l-.072-.148a.9.9 0 0 0-.565-.472a1 1 0 0 0-.474.007m4.184 2c-.131.071-.223.25-.195.383c.031.143.157.288.353.407c.105.063.112.072.117.136c.004.038-.01.146-.029.243c-.02.094-.036.194-.036.222c.002.074.07.195.143.253c.064.052.076.054.255.059c.164.005.198.001.264-.03c.169-.082.212-.234.15-.525c-.052-.243-.042-.28.087-.355c.137-.08.281-.219.324-.314a.365.365 0 0 0-.175-.48a.4.4 0 0 0-.181-.033c-.126 0-.207.03-.355.124l-.085.053l-.053-.032c-.219-.13-.259-.145-.391-.143a.4.4 0 0 0-.193.032m.39-2.195c-.373.036-.475.05-.654.086a4.5 4.5 0 0 0-.951.328c-.94.46-1.589 1.226-1.787 2.114c-.04.176-.045.234-.045.53c0 .294.005.357.043.524c.264 1.16 1.332 2.017 2.714 2.173c.3.033 1.596.033 1.896 0c1.11-.125 2.064-.727 2.493-1.571c.114-.226.169-.372.22-.602c.039-.167.044-.23.044-.523c0-.297-.005-.355-.045-.531c-.288-1.29-1.539-2.304-3.072-2.497a7 7 0 0 0-.855-.031zm.645.937a3.3 3.3 0 0 1 1.44.514c.223.148.537.458.671.662c.166.251.26.508.303.82c.02.143.01.251-.043.482c-.08.345-.332.705-.672.957a3 3 0 0 1-.689.348c-.382.122-.632.144-1.525.138c-.582-.006-.686-.01-.853-.042q-.856-.16-1.35-.68c-.264-.28-.385-.535-.45-.946c-.03-.192.025-.509.137-.776c.136-.326.488-.73.836-.963c.403-.269.934-.46 1.422-.512c.187-.02.586-.02.773-.002m-5.503-11a1.65 1.65 0 0 0-.683.298C5.617.74 5.173 1.666 4.985 2.819c-.07.436-.119 1.04-.119 1.503c0 .544.064 1.24.155 1.721c.02.107.031.202.023.208l-.187.152a5.3 5.3 0 0 0-.949 1.02a5.5 5.5 0 0 0-.94 2.339a6.6 6.6 0 0 0-.023 1.357c.091.78.325 1.438.727 2.04l.13.195l-.037.064c-.269.452-.498 1.105-.605 1.732c-.084.496-.095.629-.095 1.294c0 .67.009.803.088 1.266c.095.555.288 1.143.503 1.534c.071.128.243.393.264.407c.007.003-.014.067-.046.141a7.4 7.4 0 0 0-.548 1.873a5 5 0 0 0-.071.991c0 .56.031.832.148 1.279L3.42 24h1.478l-.05-.091c-.297-.552-.325-1.575-.068-2.597c.117-.472.25-.819.498-1.296l.148-.29v-.177c0-.165-.003-.184-.057-.293a.9.9 0 0 0-.194-.25a1.7 1.7 0 0 1-.385-.543c-.424-.92-.506-2.286-.208-3.451c.124-.486.329-.918.544-1.154a.8.8 0 0 0 .223-.531c0-.195-.07-.355-.224-.522a3.14 3.14 0 0 1-.817-1.729c-.14-.96.114-2.005.69-2.834c.563-.814 1.353-1.336 2.237-1.475c.199-.033.57-.028.776.01c.226.04.367.028.512-.041c.179-.085.268-.19.374-.431c.093-.215.165-.333.36-.576c.234-.29.46-.489.822-.729c.413-.27.884-.467 1.352-.561c.17-.035.25-.04.569-.04s.398.005.569.04a4.07 4.07 0 0 1 1.914.997c.117.109.398.457.488.602c.034.057.095.177.132.267c.105.241.195.346.374.43c.14.068.286.082.503.045c.343-.058.607-.053.943.016c1.144.23 2.14 1.173 2.581 2.437c.385 1.108.276 2.267-.296 3.153c-.097.15-.193.27-.333.419c-.301.322-.301.722-.001 1.053c.493.539.801 1.866.708 3.036c-.062.772-.26 1.463-.533 1.854a2 2 0 0 1-.224.258a.9.9 0 0 0-.194.25c-.054.109-.057.128-.057.293v.178l.148.29c.248.476.38.823.498 1.295c.253 1.008.231 2.01-.059 2.581a1 1 0 0 0-.044.098c0 .006.329.009.732.009h.73l.02-.074l.036-.134c.019-.076.057-.3.088-.516a9 9 0 0 0 0-1.258c-.11-.875-.295-1.57-.597-2.226c-.032-.074-.053-.138-.046-.141a1.4 1.4 0 0 0 .108-.152c.376-.569.607-1.284.724-2.228c.031-.26.031-1.378 0-1.628c-.083-.645-.182-1.082-.348-1.525a6 6 0 0 0-.329-.7l-.038-.064l.131-.194c.402-.604.636-1.262.727-2.04a6.6 6.6 0 0 0-.024-1.358a5.5 5.5 0 0 0-.939-2.339a5.3 5.3 0 0 0-.95-1.02l-.186-.152a.7.7 0 0 1 .023-.208c.208-1.087.201-2.443-.017-3.503c-.19-.924-.535-1.658-.98-2.082c-.354-.338-.716-.482-1.15-.455c-.996.059-1.8 1.205-2.116 3.01a7 7 0 0 0-.097.726c0 .036-.007.066-.015.066a1 1 0 0 1-.149-.078A4.86 4.86 0 0 0 12 3.03c-.832 0-1.687.243-2.456.698a1 1 0 0 1-.148.078c-.008 0-.015-.03-.015-.066a7 7 0 0 0-.097-.725C8.997 1.392 8.337.319 7.46.048a2 2 0 0 0-.585-.041Zm.293 1.402c.248.197.523.759.682 1.388c.03.113.06.244.069.292c.007.047.026.152.041.233c.067.365.098.76.102 1.24l.002.475l-.12.175l-.118.178h-.278c-.324 0-.646.041-.954.124l-.238.06c-.033.007-.038-.003-.057-.144a8.4 8.4 0 0 1 .016-2.323c.124-.788.413-1.501.696-1.711c.067-.05.079-.049.157.013m9.825-.012c.17.126.358.46.498.888c.28.854.36 2.028.212 3.145c-.019.14-.024.151-.057.144l-.238-.06a3.7 3.7 0 0 0-.954-.124h-.278l-.119-.178l-.119-.175l.002-.474c.004-.669.066-1.19.214-1.772c.157-.623.434-1.185.68-1.382c.078-.062.09-.063.159-.012"/>',
};

// hand-drawn type glyphs, stroke style so they read at 15px on the tinted chips
const TYPE = {
  agent: '<g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3.2"/><rect x="4.6" y="6.2" width="14.8" height="12.6" rx="3"/><path d="M9.2 12.4h.01M14.8 12.4h.01"/><path d="M9.4 15.6c.8.7 1.7 1 2.6 1s1.8-.3 2.6-1"/></g>',
  skill: '<path fill="currentColor" d="M11.2 2.8 12.9 8l5.2 1.7-5.2 1.7-1.7 5.2-1.7-5.2L4.3 9.7 9.5 8Zm6.6 10.4.9 2.7 2.7.9-2.7.9-.9 2.7-.9-2.7-2.7-.9 2.7-.9Z"/>',
  command: '<g fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7l5.4 5L5 17"/><path d="M12.6 17.5H19"/></g>',
};

const KEY_ALIASES = [
  ['claude', 'claude'], ['anthropic', 'anthropic'],
  ['codex', 'openai'], ['openai', 'openai'], ['gpt', 'openai'],
  ['antigravity', 'antigravity'], ['agy', 'antigravity'],
  ['gemini', 'gemini'],
  ['opencode', 'opencode'],
  ['hermes', 'hermes'], ['nous', 'hermes'],
  ['kimi', 'kimi'],
  ['ollama', 'ollama'], ['llama', 'ollama'],
  ['mcp', 'mcp'],
];

// Best icon for a free-form id/name/title ("Codex", "install Gemini CLI"…).
export function iconKeyFor(text) {
  const t = String(text || '').toLowerCase();
  for (const [needle, key] of KEY_ALIASES) if (t.includes(needle)) return key;
  return null;
}

export function iconSvg(key) {
  const body = BRAND[key] || TYPE[key];
  return body ? `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>` : '';
}

// Is this somebody else's logo, as opposed to one of our own drawings?
// Brand marks get their own colours; everything else is coloured by kind.
export function isBrandKey(key) {
  return Object.prototype.hasOwnProperty.call(BRAND, key);
}

// ---- workspace tree icons --------------------------------------------------
// Folder faces for the file tree, VSCode-icon-theme style but hand-cut: one
// wobbly folder silhouette, a small badge for well-known folder names, a page
// for files. Strokes ride currentColor (inked by --tree-ink via CSS) and fills
// use the --tree-fill tokens inline, so the operator theme re-colours the whole
// set without a second set of drawings.

const TREE_BADGES = {
  code: '<path d="M6 6.6 L4.6 8 L6 9.4 M8.6 6.6 L10 8 L8.6 9.4" stroke-width="1.1" stroke-linecap="round"/>',
  tests: '<path d="M6 8.2 L7.3 9.4 L9.6 6.6" stroke-width="1.2" stroke-linecap="round"/>',
  docs: '<path d="M5.4 6.4 L5.4 9.6 M5.4 6.4 C6.4 5.8 7.4 5.8 7.7 6.4 L7.7 9.6 M7.7 6.4 C8.4 5.8 9.6 5.8 10.2 6.4 L10.2 9.6" stroke-width="1"/>',
  assets: '<circle cx="6.6" cy="7" r="0.9" fill="currentColor" stroke="none"/><path d="M5.4 9.8 L7.6 7.6 L9 9 L10.4 7.8" stroke-width="1.1" stroke-linecap="round"/>',
  scripts: '<path d="M5.4 6.6 L7 8 L5.4 9.4 M8 9.6 L10.4 9.6" stroke-width="1.1" stroke-linecap="round"/>',
  build: '<path d="M5.6 7.2 L7.8 6.2 L10 7.2 L10 9.2 L7.8 10.2 L5.6 9.2 Z M5.6 7.2 L7.8 8.2 L10 7.2 M7.8 8.2 L7.8 10.2" stroke-width="0.9"/>',
  config: '<circle cx="7.8" cy="8" r="1.7" stroke-width="1"/><path d="M7.8 5.7 L7.8 6.6 M7.8 9.4 L7.8 10.3 M5.6 8 L6.4 8 M9.2 8 L10 8" stroke-width="1" stroke-linecap="round"/>',
};

const TREE_NAMES = {
  code: ['src', 'lib', 'app', 'apps', 'source', 'packages'],
  tests: ['test', 'tests', 'spec', 'specs', '__tests__', 'e2e'],
  docs: ['doc', 'docs', 'documentation', 'notes', 'wiki'],
  assets: ['asset', 'assets', 'img', 'image', 'images', 'media', 'public', 'static', 'icons', 'fonts'],
  scripts: ['script', 'scripts', 'bin', 'tools'],
  build: ['build', 'dist', 'out', 'output', 'target', 'release', 'releases'],
  deps: ['node_modules', 'vendor', 'venv', '.venv', 'bower_components'],
};

// Which face a folder wears. deps beats the dot-folder rule so .venv dims like
// node_modules instead of getting the config gear.
export function treeBadgeFor(name) {
  const n = String(name || '').toLowerCase();
  for (const [badge, names] of Object.entries(TREE_NAMES)) if (names.includes(n)) return badge;
  if (n.startsWith('.')) return 'config';
  return null;
}

const FOLDER_BODY = 'M1.2 3.4 L1.6 11.2 L13.6 11.4 L14 5 L6.4 4.8 L5.4 2 L1.6 1.8 Z';
const FOLDER_FLAP = 'M2.4 11.1 L4.6 6 L14.6 6.2 L13.4 11.3 Z';

// Folders wear seven faces; files used to wear one, for all of them — in the one
// place you are scanning for a file. These sit in the page's lower body, at the
// same weight as the folder badges, and ride the same tokens: nothing here is
// coloured, so all four themes re-ink the set without a second set of drawings.
export const FILE_BADGES = {
  image: '<circle cx="4.9" cy="7.6" r="0.75" fill="currentColor" stroke="none"/><path d="M3.6 10.9 L5.8 8.7 L7 9.9 L8.3 8.6 L9.6 10.9" stroke-width="1"/>',
  media: '<path d="M5.2 7.5 L8.9 9.3 L5.2 11.1 Z" fill="currentColor" stroke="none"/>',
  pdf: '<path d="M3.9 7.4 h5.3 v1.7 h-5.3 z" fill="currentColor" stroke="none"/><path d="M3.9 10.7 h3.5" stroke-width="1"/>',
  web: '<circle cx="6.5" cy="9.2" r="2.2" stroke-width="0.95"/><path d="M4.3 9.2 h4.4 M6.5 7 c1.15 1.35 1.15 3.05 0 4.4 M6.5 7 c-1.15 1.35 -1.15 3.05 0 4.4" stroke-width="0.85"/>',
  doc: '<path d="M3.9 7.2 h5.2 M3.9 9 h5.2 M3.9 10.8 h3.2" stroke-width="1"/>',
  code: '<path d="M5.5 7.5 L4.2 9.2 L5.5 10.9 M7.7 7.5 L9 9.2 L7.7 10.9" stroke-width="1.05" stroke-linecap="round"/>',
  config: '<circle cx="6.5" cy="9.2" r="1.45" stroke-width="0.95"/><path d="M6.5 6.8 v0.9 M6.5 10.7 v0.9 M4.3 9.2 h0.9 M7.8 9.2 h0.9" stroke-width="0.95" stroke-linecap="round"/>',
  lock: '<path d="M4.5 8.9 h4 v2.6 h-4 z" stroke-width="1"/><path d="M5.5 8.9 v-1.1 a1 1 0 0 1 2 0 v1.1" stroke-width="1"/>',
};

const FILE_EXT = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'],
  media: ['mp4', 'webm', 'mov', 'm4v', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac'],
  pdf: ['pdf'],
  web: ['html', 'htm'],
  doc: ['md', 'mdx', 'txt', 'rst'],
  code: ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'swift', 'sh'],
  config: ['json', 'yaml', 'yml', 'toml', 'ini', 'env', 'conf'],
};

// Which face a file wears. Lock is tested first and by whole name, because
// package-lock.json is a lock before it is a .json — and it is the file you most
// want to recognise without reading, so it never has to compete on extension.
export function fileBadgeFor(name) {
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.lock') || n.endsWith('-lock.json')) return 'lock';
  const i = n.lastIndexOf('.');
  if (i < 1) return null;   // i === 0 is a dotfile, not an extension
  const ext = n.slice(i + 1);
  for (const [badge, exts] of Object.entries(FILE_EXT)) if (exts.includes(ext)) return badge;
  return null;
}

export function treeIcon(name, kind, open) {
  if (kind !== 'dir') {
    const badge = fileBadgeFor(name);
    return `<svg width="13" height="14" viewBox="0 0 13 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true">
      <path d="M2 1.4 L8.6 1.2 L11.2 3.8 L11 12.6 L2.2 12.8 Z" style="fill:var(--tree-fill-file)"/>
      <path d="M8.4 1.4 L8.6 4 L11 4.1"/>${badge ? FILE_BADGES[badge] : '<path d="M4 7 L9 7 M4 9.2 L8 9.2" stroke-width="1"/>'}</svg>`;
  }
  const badge = treeBadgeFor(name);
  if (badge === 'deps') {
    // dependency dumps are noise, not a destination — dashed outline, dimmed
    return `<svg width="15" height="13" viewBox="0 0 15 13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-dasharray="2 1.6" style="opacity:.55" aria-hidden="true">
      <path d="${FOLDER_BODY}"/></svg>`;
  }
  return `<svg width="15" height="13" viewBox="0 0 15 13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true">
    <path d="${FOLDER_BODY}" style="fill:var(--tree-fill)"/>
    ${open ? `<path d="${FOLDER_FLAP}" style="fill:var(--tree-fill-open)"/>` : ''}
    ${badge ? TREE_BADGES[badge] : ''}</svg>`;
}

const escChip = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// A .code chip: brand/type glyph when known, two-letter code otherwise.
//
// Colour still comes from CSS and never from an inline hex, so each theme
// re-inks the whole set in one place. Which rule applies depends on what the
// chip is:
//
//   data-kind   our own drawings — skills, commands, editors, shells. One hue
//               per kind of thing, so the set is learnable at a glance.
//   data-brand  somebody else's logo. Claude is clay, OpenAI is black, Gemini
//               is blue, because that is what they are everywhere else. Six
//               agents tinted identically read as one agent six times.
//
// Both attributes are emitted, so layout rules keyed on kind still apply and a
// theme can drop back to the kind hue by not defining a brand rule.
export function chipHtml({ key, code, kind }) {
  const svg = key ? iconSvg(key) : '';
  const brand = key && isBrandKey(key) ? ` data-brand="${escChip(key)}"` : '';
  return `<span class="code${svg ? ' code--icon' : ''}" data-kind="${escChip(kind || 'neutral')}"${brand}>${svg || escChip(code)}</span>`;
}

// ---- pixel glyphs (glass/graphite themes) -----------------------------------
// 7×7 dot-grid twins of the chrome glyphs (◐ ⚙ ⤢ ✕ ＋ ⚑). Markup renders both
// the unicode glyph (.uni-i) and this SVG (.pix-i); the glass themes flip
// visibility in CSS, so paper/operator keep their exact DOM and look.
// Each entry is [path, grid]. The grid used to be 7 for everything and implicit
// in pixIcon — fine until something needed detail that seven cells cannot hold.
// A gear is the case that broke it: seven pixels can carry a ring or teeth, not
// both, so every hand-drawn attempt came out as a donut or a plus. Sixteen is
// the other good number here — at a 16px glyph that is exactly one cell per CSS
// pixel, so a finer drawing stays as crisp as a coarse one.
export const PIX = {
  // half-filled circle: solid light half, dotted dark rim — "switch appearance"
  theme: ['M2 0h3v1H2z M1 1h3v1H1z M5 1h1v1H5z M0 2h4v1H0z M6 2h1v1H6z M0 3h4v1H0z M6 3h1v1H6z M0 4h4v1H0z M6 4h1v1H6z M1 5h3v1H1z M5 5h1v1H5z M2 6h3v1H2z', 7],
  // An eight-tooth cog, rasterised from real gear geometry rather than drawn:
  // tip radius 1.0, root 0.66, hub 0.28, and the lit cells merged into runs.
  // It replaces three sliders, which read as "filters" or "levels" — the one
  // glyph in the set that named the wrong thing.
  settings: ['M6 0h4v1H6z M3 1h1v1H3z M6 1h4v1H6z M12 1h1v1H12z M2 2h3v1H2z M7 2h2v1H7z M11 2h3v1H11z M1 3h14v1H1z M2 4h12v1H2z M3 5h10v1H3z M0 6h2v1H0z M3 6h3v1H3z M10 6h3v1H10z M14 6h2v1H14z M0 7h6v1H0z M10 7h6v1H10z M0 8h6v1H0z M10 8h6v1H10z M0 9h2v1H0z M3 9h3v1H3z M10 9h3v1H10z M14 9h2v1H14z M3 10h10v1H3z M2 11h12v1H2z M1 12h14v1H1z M2 13h3v1H2z M7 13h2v1H7z M11 13h3v1H11z M3 14h1v1H3z M6 14h4v1H6z M12 14h1v1H12z M6 15h4v1H6z', 16],
  // Cut on 16 to match the cog: a chunky 7×7 question mark beside a fine cog
  // reads as two different icon sets on the same toolbar.
  help: ['M5 0h6v1H5z M3 1h10v1H3z M2 2h4v1H2z M10 2h4v1H10z M2 3h3v1H2z M11 3h3v1H11z M11 4h3v1H11z M10 5h4v1H10z M9 6h4v1H9z M8 7h4v1H8z M7 8h4v1H7z M7 9h3v2H7z M7 12h3v3H7z', 16],
  expand: ['M4 0h3v3H6V1H4z M0 4h1v2h2v1H0z M4 2h1v1H4z M3 3h1v1H3z M2 4h1v1H2z', 7],
  close: ['M0 0h1v1H0z M6 0h1v1H6z M1 1h1v1H1z M5 1h1v1H5z M2 2h1v1H2z M4 2h1v1H4z M3 3h1v1H3z M2 4h1v1H2z M4 4h1v1H4z M1 5h1v1H1z M5 5h1v1H5z M0 6h1v1H0z M6 6h1v1H6z', 7],
  plus: ['M3 0h1v2H3z M3 5h1v2H3z M0 3h2v1H0z M5 3h2v1H5z M3 2h1v1H3z M3 4h1v1H3z M2 3h1v1H2z M4 3h1v1H4z', 7],
  flag: ['M1 0h1v7H1z M2 0h4v1H2z M2 3h4v1H2z M6 1h1v2H6z', 7],
  minus: ['M1 3h5v1H1z', 7],
  // a small v — the tile head's "more surfaces / settings" menu
  chevron: ['M0 2h1v1H0z M1 3h1v1H1z M2 4h1v1H2z M3 5h1v1H3z M4 4h1v1H4z M5 3h1v1H5z M6 2h1v1H6z', 7],
  // the card composer: an up arrow to send, a capsule-and-cradle mic
  send: ['M3 0h1v7H3z M2 1h1v1H2z M4 1h1v1H4z M1 2h1v1H1z M5 2h1v1H5z M0 3h1v1H0z M6 3h1v1H6z', 7],
  mic: ['M2 0h3v4H2z M1 3h1v2H1z M5 3h1v2H5z M2 5h3v1H2z M3 6h1v1H3z', 7],
};
export function pixIcon(name) {
  const glyph = PIX[name];
  if (!glyph) return '';
  const [d, grid] = glyph;
  // crispEdges matters on the 16-grids: without it the browser antialiases the
  // cell boundaries and a pixel glyph stops looking like one.
  return `<svg class="pix-glyph" viewBox="0 0 ${grid} ${grid}" shape-rendering="crispEdges" aria-hidden="true"><path d="${d}"/></svg>`;
}
