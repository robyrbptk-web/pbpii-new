/**
 * PBPIIMarkdown — perender Markdown untuk jawaban Tanya PII.
 *
 * Semua teks di-escape lebih dulu dan hanya tag dari daftar putih yang pernah
 * diterbitkan, jadi HTML atau skrip dari model tidak bisa berjalan di browser.
 * Tidak ada dependensi eksternal: penyorotan sintaks, tabel, blok terminal, dan
 * matematika ditulis sendiri supaya tetap bekerja saat luring maupun di PWA.
 */
(() => {
  'use strict';

  const LIPAT_BARIS = 20;

  // ------------------------------------------------------------------ util

  function escapeHTML(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/[&<>"']/g, (karakter) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[karakter]);
  }

  const BARIS = (teks) => String(teks === undefined ? '' : teks).replace(/\r\n?/g, '\n').split('\n');
  const kosong = (baris) => !String(baris).trim();

  function indentLebar(baris) {
    const spasi = String(baris).match(/^[ ]*/)[0].length;
    const tab = String(baris).slice(0, spasi).split('\t').length - 1;
    let kini = 0;
    for (const karakter of String(baris)) {
      if (karakter === ' ') kini += 1;
      else if (karakter === '\t') kini += 2 - (kini % 2);
      else break;
    }
    return kini + tab;
  }

  function potongIndent(baris, jumlah) {
    let sisa = jumlah;
    let i = 0;
    while (i < baris.length && sisa > 0) {
      if (baris[i] === ' ') sisa -= 1;
      else if (baris[i] === '\t') sisa -= 2;
      else break;
      i += 1;
    }
    return baris.slice(i);
  }

  // --------------------------------------------------------------- bahasa

  const KUNCI_BAHASA = {
    javascript: 'js', js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx',
    typescript: 'ts', ts: 'ts', tsx: 'tsx', dart: 'dart',
    json: 'json', json5: 'json', jsonc: 'json', html: 'html', htm: 'html', xml: 'xml',
    css: 'css', scss: 'scss', less: 'less', stylus: 'styl',
    python: 'py', py: 'py', php: 'php', sql: 'sql', mysql: 'sql', postgres: 'sql',
    postgresql: 'sql', plsql: 'sql', sqlite: 'sql', markdown: 'md', md: 'md', mdx: 'md',
    bash: 'sh', shell: 'sh', sh: 'sh', zsh: 'sh', ksh: 'sh', console: 'sh', terminal: 'sh',
    shellsession: 'sh', powershell: 'ps1', ps1: 'ps1', pwsh: 'ps1', psm1: 'ps1',
    batch: 'bat', bat: 'bat', cmd: 'bat', java: 'java', kotlin: 'kt', kt: 'kt',
    cpp: 'cpp', 'c++': 'cpp', c: 'c', csharp: 'cs', cs: 'cs', objectivec: 'm',
    go: 'go', golang: 'go', rust: 'rs', rs: 'rs', ruby: 'rb', rb: 'rb', swift: 'swift',
    yaml: 'yml', yml: 'yml', toml: 'toml', ini: 'ini', env: 'ini', properties: 'ini',
    dockerfile: 'docker', diff: 'diff', patch: 'diff', text: 'txt', txt: 'txt',
    plain: 'txt', plaintext: 'txt', matlab: 'matlab', octave: 'matlab', r: 'r', lua: 'lua',
  };

  const NAMA_BAHASA = {
    js: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', tsx: 'TSX', dart: 'Dart', json: 'JSON',
    html: 'HTML', xml: 'XML', css: 'CSS', scss: 'SCSS', less: 'Less', styl: 'Stylus',
    py: 'Python', php: 'PHP', sql: 'SQL', md: 'Markdown', sh: 'Shell', ps1: 'PowerShell',
    bat: 'Batch', java: 'Java', kt: 'Kotlin', cpp: 'C++', c: 'C', m: 'Objective-C', cs: 'C#',
    go: 'Go', rs: 'Rust', rb: 'Ruby', swift: 'Swift', yml: 'YAML', toml: 'TOML', ini: 'INI',
    docker: 'Dockerfile', diff: 'Diff', txt: 'Teks', matlab: 'MATLAB', r: 'R', lua: 'Lua',
  };

  const EKTENSI = {
    js: 'js', jsx: 'jsx', ts: 'ts', tsx: 'tsx', dart: 'dart', json: 'json', html: 'html',
    xml: 'xml', css: 'css', scss: 'scss', less: 'less', styl: 'styl', py: 'py', php: 'php',
    sql: 'sql', md: 'md', sh: 'sh', ps1: 'ps1', bat: 'bat', java: 'java', kt: 'kt',
    cpp: 'cpp', c: 'c', m: 'm', cs: 'cs', go: 'go', rs: 'rs', rb: 'rb', swift: 'swift',
    yml: 'yml', toml: 'toml', ini: 'ini', docker: 'dockerfile', diff: 'diff', txt: 'txt',
    matlab: 'm', r: 'r', lua: 'lua',
  };

  const BAHASA_TERMINAL = new Set(['sh', 'ps1', 'bat']);

  function kunciBahasa(teks) {
    const kata = String(teks || '').toLowerCase().split(/[^a-z0-9+#]+/).filter(Boolean);
    for (const satu of kata) if (KUNCI_BAHASA[satu]) return KUNCI_BAHASA[satu];
    return kata[0] || '';
  }

  function namaBahasa(kunci) {
    if (NAMA_BAHASA[kunci]) return NAMA_BAHASA[kunci];
    const cantik = String(kunci || '').split(/\s+/).filter(Boolean).join(' ')
      .replace(/(^|\s)([a-z])/g, (m, sp, c) => sp + c.toUpperCase());
    return cantik || 'Kode';
  }

  // -------------------------------------------------- penyorotan sintaks

  const BLOK_KOMENTAR = {
    js: '/\\*[\\s\\S]*?(?:\\*/|$)|//[^\\n]*', ts: '/\\*[\\s\\S]*?(?:\\*/|$)|//[^\\n]*',
    java: '/\\*[\\s\\S]*?(?:\\*/|$)|//[^\\n]*', kt: '/\\*[\\s\\S]*?(?:\\*/|$)|//[^\\n]*',
    swift: '/\\*[\\s\\S]*?(?:\\*/|$)|//[^\\n]*', m: '/\\*[\\s\\S]*?(?:\\*/|$)|//[^\\n]*',
    c: '/\\*[\\s\\S]*?(?:\\*/|$)|//[^\\n]*', cpp: '/\\*[\\s\\S]*?(?:\\*/|$)|//[^\\n]*',
    cs: '/\\*[\\s\\S]*?(?:\\*/|$)|//[^\\n]*', go: '/\\*[\\s\\S]*?(?:\\*/|$)|//[^\\n]*',
    rs: '/\\*[\\s\\S]*?(?:\\*/|$)|//[^\\n]*', php: '/\\*[\\s\\S]*?(?:\\*/|$)|//[^\\n]*|#[^\\n]*',
    css: '/\\*[\\s\\S]*?(?:\\*/|$)', scss: '/\\*[\\s\\S]*?(?:\\*/|$)|//[^\\n]*',
    less: '/\\*[\\s\\S]*?(?:\\*/|$)|//[^\\n]*', yml: '#[^\\n]*', toml: '#[^\\n]*',
    ini: '[;#][^\\n]*', py: '#[^\\n]*', rb: '#[^\\n]*', r: '#[^\\n]*', matlab: '%[^\\n]*',
    lua: '--[^\\n]*', sql: '--[^\\n]*', sh: '#[^\\n]*', ps1: '#[^\\n]*',
    bat: '(?:REM|::)[^\\n]*', docker: '#[^\\n]*', dart: '/\\*[\\s\\S]*?(?:\\*/|$)|//[^\\n]*',
  };

  const GARIS_KOMENTAR = {
    html: '<!--[\\s\\S]*?(?:-->|$)', xml: '<!--[\\s\\S]*?(?:-->|$)', diff: '(?:^|\\n)#[^\\n]*',
  };

  const KATA_KUNCI = {
    js: 'const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|delete|void|yield|static|this|super|null|undefined|true|false',
    ts: 'const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|implements|interface|enum|type|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|keyof|readonly|as|in|of|public|private|protected|static|this|super|null|undefined|true|false|void|never|unknown|any|string|number|boolean',
    java: 'abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|goto|if|implements|import|instanceof|int|interface|long|native|new|package|private|protected|public|return|short|static|super|switch|synchronized|this|throw|throws|transient|try|var|void|volatile|while|true|false|null|record|sealed',
    kt: 'abstract|annotation|as|break|by|catch|class|companion|const|constructor|continue|data|do|else|enum|expect|external|final|finally|fun|get|if|import|in|infix|init|inline|inner|interface|internal|is|lateinit|noinline|null|out|override|private|protected|public|reified|return|sealed|set|super|suspend|tailrec|this|throw|try|typealias|val|var|vararg|when|while|true|false',
    swift: 'class|deinit|enum|extension|func|import|init|inout|let|operator|protocol|struct|subscript|typealias|var|break|case|continue|default|do|else|fallthrough|for|guard|if|in|return|switch|where|while|as|is|nil|true|false|try|catch|throw|async|await|public|private|internal|open|static|final|override|mutating|self|super',
    c: 'auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|inline|int|long|register|restrict|return|short|signed|sizeof|static|struct|switch|typedef|union|unsigned|void|volatile|while|NULL|true|false',
    cpp: 'alignas|alignof|asm|auto|bool|break|case|catch|char|class|const|constexpr|continue|decltype|default|delete|do|double|dynamic_cast|else|enum|explicit|export|extern|float|for|friend|goto|if|inline|int|long|namespace|new|noexcept|nullptr|operator|private|protected|public|register|reinterpret_cast|return|short|signed|sizeof|static|static_cast|struct|switch|template|this|thread_local|throw|try|typedef|typename|union|unsigned|using|virtual|void|volatile|while|true|false',
    cs: 'abstract|as|async|await|base|bool|break|byte|case|catch|char|checked|class|const|continue|decimal|default|delegate|do|double|else|enum|event|explicit|extern|false|finally|fixed|float|for|foreach|goto|if|implicit|in|int|interface|internal|is|lock|long|namespace|new|null|object|operator|out|override|params|private|protected|public|readonly|ref|return|sbyte|sealed|short|sizeof|stackalloc|static|string|struct|switch|this|throw|true|try|typeof|uint|ulong|unsafe|ushort|using|var|virtual|void|volatile|while|record',
    go: 'break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var|true|false|nil|iota',
    rs: 'as|box|break|const|continue|crate|dyn|else|enum|extern|false|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|true|type|unsafe|use|where|while|async|await',
    php: 'abstract|and|array|as|break|callable|case|catch|class|clone|const|continue|declare|default|do|echo|else|elseif|empty|enddeclare|endfor|endforeach|endif|endswitch|endwhile|extends|final|finally|fn|for|foreach|function|global|goto|if|implements|include|include_once|instanceof|insteadof|interface|isset|list|match|namespace|new|null|or|print|private|protected|public|readonly|require|require_once|return|static|switch|throw|trait|try|unset|use|var|while|yield|true|false',
    py: 'and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|True|False|None|self|cls|match|case',
    rb: 'alias|and|begin|break|case|class|def|defined|do|else|elsif|end|ensure|for|if|in|module|next|nil|not|or|redo|rescue|retry|return|self|super|then|undef|unless|until|when|while|yield|true|false|require',
    r: 'if|else|for|while|repeat|function|return|break|next|in|TRUE|FALSE|NULL|NA|Inf|NaN|library|require|source',
    matlab: 'break|case|catch|continue|else|elseif|end|for|function|global|if|otherwise|parfor|persistent|return|switch|try|while|true|false',
    lua: 'and|break|do|else|elseif|end|for|function|goto|if|in|local|nil|not|or|repeat|return|then|until|while|self|true|false',
    sql: 'ABS|ADD|ALL|ALTER|AND|ANY|AS|ASC|AVG|BEGIN|BETWEEN|BY|CASE|CAST|CHECK|COLUMN|COMMIT|CONSTRAINT|COUNT|CREATE|CROSS|DATABASE|DEFAULT|DELETE|DESC|DESCRIBE|DISTINCT|DROP|ELSE|END|EXCEPT|EXISTS|FROM|FULL|GROUP|HAVING|IF|IN|INDEX|INNER|INSERT|INT|INTERSECT|INTO|IS|JOIN|KEY|LEFT|LIKE|LIMIT|MAX|MIN|NOT|NULL|OFFSET|ON|OR|ORDER|OUTER|PRIMARY|REFERENCES|RIGHT|SELECT|SET|SHOW|SUM|TABLE|TEXT|THEN|TOP|UNION|UNIQUE|UPDATE|USE|USING|VALUES|VIEW|VARCHAR|WHEN|WHERE|WITH',
    sh: 'if|then|else|elif|fi|for|while|until|do|done|case|esac|in|function|return|local|export|source|set|unset|shift|trap|eval|exec|read|echo|printf|true|false|break|continue|and|or',
    ps1: 'begin|break|catch|class|continue|data|do|dynamicparam|else|elseif|end|filter|finally|for|foreach|from|function|if|in|param|process|return|switch|throw|trap|try|until|using|var|while|workflow|true|false|null',
    bat: 'call|echo|endlocal|exit|for|goto|if|pause|set|shift|start|title|type|cls|copy|del|dir|md|mkdir|rd|rmdir|move|ren|xcopy|ping|net|sc|reg|taskkill',
    docker: 'FROM|RUN|CMD|LABEL|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL|AS',
    css: 'import|media|supports|keyframes|font-face|page|layer|container|important',
    scss: 'import|use|forward|extend|mixin|include|at-root|each|if|else|for|while|function|return|media|supports|debug|warn|error',
    yml: 'true|false|null|yes|no|on|off',
    toml: 'true|false',
    dart: 'abstract|as|assert|async|await|break|case|catch|class|const|continue|default|do|dynamic|else|enum|extends|extension|external|factory|final|finally|for|get|if|implements|import|in|interface|late|new|null|on|operator|part|return|set|static|super|switch|sync|this|throw|try|typedef|var|void|while|with|yield|true|false',
    html: '', xml: '', ini: '', txt: '', diff: '', md: '',
  };

  const PERPUSTAKA = {
    js: 'console|document|window|globalThis|Math|JSON|Array|Object|String|Number|Boolean|Promise|Map|Set|WeakMap|Date|RegExp|Buffer|require|module|process|fetch|localStorage|sessionStorage|setTimeout|setInterval|navigator',
    ts: 'console|document|window|Math|JSON|Array|Object|String|Number|Boolean|Promise|Map|Set|Date|RegExp|require|module|process|fetch',
    py: 'print|len|range|int|str|float|list|dict|set|tuple|bytes|open|enumerate|zip|map|filter|sum|min|max|abs|round|type|isinstance|super|import|os|sys|re|json|math|random|datetime|pathlib|requests|pandas|numpy|collections|itertools',
    java: 'System|String|Integer|Double|Boolean|List|ArrayList|Map|HashMap|Set|Arrays|Collections|Object|Exception|Optional|Stream|Integer|Objects',
    kt: 'listOf|mapOf|setOf|arrayOf|println|print|require|TODO|Lazy|Sequence|Result',
    php: 'echo|print|var_dump|print_r|count|array|isset|empty|unset|strlen|strpos|stripos|substr|str_replace|preg_match|preg_replace|explode|implode|json_encode|json_decode|file_get_contents|file_put_contents|PDO|mysqli|Exception|compact|extract',
    go: 'fmt|errors|strings|strconv|time|context|sync|net|http|json|os|io|make|len|cap|append|copy|panic|recover|nil',
    rs: 'Vec|String|Box|Option|Result|HashMap|HashSet|println|print|format|Some|None|Ok|Err|self|impl|pub|mut|use|fn|let|String|serde',
    rb: 'puts|print|require|require_relative|attr_accessor|attr_reader|map|each|select|reject|reduce|nil|self|class|module|Proc|Lambda',
    sql: 'COUNT|SUM|AVG|MAX|MIN|COALESCE|NULLIF|CAST|GROUP_CONCAT|STRING_AGG|ROUND|NOW|CURDATE|CURRENT_TIMESTAMP|CONCAT|LOWER|UPPER|SUBSTRING|DATE_TRUNC|ROW_NUMBER|RANK|EXISTS|ILIKE',
    sh: 'grep|sed|awk|curl|wget|docker|kubectl|git|npm|npx|pnpm|yarn|node|python|python3|pip|pip3|systemctl|journalctl|chmod|chown|tar|zip|unzip|ssh|scp|rsync|cat|head|tail|less|sort|uniq|wc|xargs|find|locate|source|export|env|uname|whoami|ps|kill|top|df|du|mount|cp|mv|rm|mkdir|touch|ls|cd|make|apt|apt-get|yum|dnf|brew|sudo|echo|printf|test|time',
    ps1: 'Get-Process|Get-Service|Get-ChildItem|Get-Content|Get-Command|Get-Member|Set-Location|Set-Content|Set-Variable|New-Item|New-Object|New-Item|Remove-Item|Select-Object|Where-Object|ForEach-Object|Group-Object|Sort-Object|Measure-Object|Test-Path|Import-Module|Install-Module|Invoke-WebRequest|Invoke-RestMethod|Invoke-Expression|Write-Host|Write-Output|Write-Error|Write-Warning|Add-Type|Start-Process|Stop-Process',
    css: 'color|background|background-color|border|border-radius|margin|padding|display|flex|flex-direction|justify-content|align-items|grid|grid-template-columns|width|height|max-width|min-width|font|font-size|font-weight|line-height|position|top|right|bottom|left|transform|transition|animation|opacity|overflow|box-shadow|text-align|z-index|gap|var|calc|rem|em|px|vh|vw|%|none|flex|grid|block|inline|absolute|relative|fixed|sticky',
    scss: 'color|background|margin|padding|display|flex|grid|width|height|font|position|transform|transition|animation|opacity|overflow|box-shadow|rem|px|vh|vw',
    yml: 'version|services|image|container_name|ports|environment|volumes|depends_on|restart|build|steps|runs-on|uses|with|name|on|jobs|triggers|script|vars|stages',
    ini: 'true|false|null',
    matlab: 'disp|fprintf|plot|zeros|ones|size|length|length|numel|end',
    lua: 'print|pairs|ipairs|require|table|string|math|tostring|tonumber|type|error|pcall',
    dart: 'print|List|Map|Set|Future|Stream|int|double|String|bool|var|final|const|await|async',
  };

  const FUNGSI_POLA = {
    js: '[A-Za-z_$][\\w$]*(?=\\s*\\()', ts: '[A-Za-z_$][\\w$]*(?=\\s*[<(])',
    py: '[A-Za-z_]\\w*(?=\\s*\\()', rb: '[A-Za-z_]\\w*[!?]?(?=\\s*\\()',
    java: '[A-Za-z_$][\\w$]*(?=\\s*\\()', kt: '[A-Za-z_$][\\w$]*(?=\\s*\\()',
    swift: '[A-Za-z_$][\\w$]*(?=\\s*\\()', m: '[A-Za-z_$][\\w$]*(?=\\s*\\()',
    c: '[A-Za-z_$][\\w$]*(?=\\s*\\()', cpp: '[A-Za-z_$][\\w$]*(?=\\s*\\()',
    cs: '[A-Za-z_$][\\w$]*(?=\\s*\\()', go: '[A-Za-z_$][\\w$]*(?=\\s*\\()',
    rs: '[A-Za-z_][\\w!]*(?=\\s*\\()', php: '[A-Za-z_][\\w]*(?=\\s*\\()',
    lua: '[A-Za-z_]\\w*(?=\\s*[(])', matlab: '[A-Za-z_]\\w*(?=\\s*\\()',
    r: '[A-Za-z._]\\w*(?=\\s*\\()', dart: '[A-Za-z_$][\\w$]*(?=\\s*\\()',
    ps1: '\\b(?:Get|Set|New|Remove|Add|Invoke|Test|Write|Import|Install|Uninstall|Select|Where|ForEach|Format|Clear|Start|Stop|Restart|Enable|Disable|Export|ConvertTo|ConvertFrom)-[A-Za-z][\\w-]*\\b',
    sh: '\\b[A-Za-z_][\\w.-]*(?=\\s+[-/\\w.$])|\\b[A-Za-z_][\\w.-]*(?=\\s*$)',
    bat: '\\b[A-Za-z_][\\w.-]*(?=[ \\t]+[-/%.\\w])|\\b[A-Za-z_][\\w.-]*(?=\\s*$)',
  };

  const POLA_KHUSUS = {
    html: ['&[a-zA-Z][\\w-]{1,24};', '\\b(?:class|id|href|src|alt|type|name|value|width|height|role|aria-[\\w-]+|data-[\\w-]+)\\s*=(?=["\'])', '</?[a-zA-Z][\\w:.-]*', '/?>'],
    xml: ['&[a-zA-Z][\\w-]{1,24};', '</?[a-zA-Z][\\w:.-]*', '/?>'],
    css: ['\\b(?:color|background(?:-color)?|border(?:-[a-z]+)*|margin(?:-[a-z]+)*|padding(?:-[a-z]+)*|font(?:-[a-z]+)*|display|width|height|max-\\w+|min-\\w+|position|top|right|bottom|left|transform|transition|animation|opacity|overflow|z-index|gap|align-\\w+|justify-\\w+|box-shadow)\\b(?=[ \\t]*:)'],
    scss: ['\\$[A-Za-z_][\\w-]*', '@(?:mixin|include|extend|use|forward|if|else|each|for|while|function|return|media|supports)\\b'],
    less: ['@[A-Za-z_][\\w-]*'],
    py: ['@[A-Za-z_][\\w.]*(?=\\()', '\\b__[a-z_]+__\\b', '\\bf(?:["\'])', '[a-zA-Z0-9_]*(?=["\'`][^"\']*\\{[^}]*\\})'],
    php: ['\\$[A-Za-z_][\\w]*', '\\\\b[A-Z][\\w]*(?=\\\\\\\\)'],
    go: ['\\b[a-z][\\w]*(?=\\s*:=)', '\\b[A-Z][\\w]*(?=\\.)'],
    rs: ['\\b(?:[a-z][a-z0-9_]*!)(?=\\()', '\\blifetime[0-9]*\\b', "'[a-z_][\\w']*"],
    sql: ['\\b[a-z_]\\w*(?=\\s*\\()', '\\b(?:[a-z_]\\w*\\.)+[a-z_]\\w*\\b', '`[^`]+`', '"[^"]+"'],
    sh: ['\\$\\{[^{}]*\\}', '\\$[A-Za-z_][\\w]*', '\\$\\([^)]*\\)', '\\b(?:-|--)[A-Za-z0-9][\\w-]*\\b'],
    ps1: ['\\$env:[A-Za-z_][\\w]*', '\\$[A-Za-z_][\\w:.-]*', '\\$\\{[^{}]*\\}', '\\B-(?:ErrorAction|NoProfile|ExecutionPolicy|Force|Recurse|Verb|Path|Name)[\\w]*\\b', '\\B-[A-Za-z]+\\b'],
    bat: ['%[A-Za-z_][\\w.]*%', '![A-Za-z_][\\w.]*!', '\\b/(?:[a-zA-Z]{1,10}|\\d{1,3})\\b'],
    docker: ['^[ \\t]*(?:FROM|RUN|CMD|COPY|ADD|ENV|ARG|EXPOSE|WORKDIR|ENTRYPOINT|USER|VOLUME|LABEL|HEALTHCHECK|SHELL|STOPSIGNAL|ONBUILD)(?=[ \\t]|$)'],
    yml: ['^[ \\t]*[\\w.$-]+(?=[ \\t]*:)', '\\{\\{[^{}]*\\}\\}'],
    toml: ['\\[+[^\\]]+\\]+', '^[ \\t]*[\\w.-]+(?=[ \\t]*=)'],
    ini: ['\\[[^\\]]+\\]', '^[ \\t]*[\\w.-]+(?=[ \\t]*=)'],
    diff: ['^(?:\\+{3,}|-{3,}|@@)[^\\n]*', '^[+][^\\n]*', '^[-][^\\n]*'],
    json: ['(?<=[{,])[ \\t]*"(?:\\\\.|[^"\\\\])*"(?=[ \\t]*:)'],
    matlab: ['\\b[A-Za-z_][\\w]*\\b(?=\\s*=\\s*[^=])'],
    cs: ['\\[(?:get|set|required|param|override|obsolete|Test|Fact|Theory)[^\\]]*\\]'],
  };

  const STRING_AWAL = {
    py: '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'',
    js: 'String\\.raw`(?:\\\\[\\s\\S]|[^`\\\\])*`',
    ts: 'String\\.raw`(?:\\\\[\\s\\S]|[^`\\\\])*`',
  };

  const ATURAN_CACHE = new Map();
  const TANPA_SPAN = new Set(['spasi', 'IDENT', 'pung']);

  function bangunAturan(kunci) {
    if (ATURAN_CACHE.has(kunci)) return ATURAN_CACHE.get(kunci);
    const daftar = [];
    const dorong = (nama, pola) => { if (pola) daftar.push({ n: nama, s: pola }); };
    dorong('komentar', BLOK_KOMENTAR[kunci]);
    dorong('komentar', GARIS_KOMENTAR[kunci]);
    if (STRING_AWAL[kunci]) dorong('string', STRING_AWAL[kunci]);
    dorong('string', '"(?:\\\\[\\s\\S]|[^"\\\\\\n])*"?|\'(?:\\\\[\\s\\S]|[^\'\\\\\\n])*\'?|`(?:\\\\[\\s\\S]|[^`\\\\])*`');
    (POLA_KHUSUS[kunci] || []).forEach((pola) => dorong('penanda', pola));
    if (KATA_KUNCI[kunci]) dorong('kata', `\\b(?:${KATA_KUNCI[kunci]})\\b`);
    if (PERPUSTAKA[kunci]) dorong('pustaka', `\\b(?:${PERPUSTAKA[kunci]})\\b`);
    dorong('fungsi', FUNGSI_POLA[kunci]);
    dorong('penanda', '@[A-Za-z_$][\\w$]*');
    dorong('nomor', '0[xXbBoO][0-9a-fA-F_]+|\\d[\\w.]*|\\.\\d[\\w.]*');
    dorong('aksi', '=>|->|::|\\.\\.\\.|&&|\\|\\||[-+*/%=<>!&|^~?]{1,3}');
    dorong('pung', '[.,;:(){}\\[\\]#]');
    dorong('spasi', '\\s+');
    dorong('IDENT', '\\S+');
    const grup = daftar.map((satu, i) => `(?<k${i}>${satu.s})`).join('|');
    const hasil = { daftar, re: new RegExp(grup, 'gm') };
    ATURAN_CACHE.set(kunci, hasil);
    return hasil;
  }

  /** Kode mentah → daftar HTML per baris. Teks selalu di-escape, tidak pernah disisipkan apa adanya. */
  function sorot(kode, kunci) {
    const asal = BARIS(kode);
    if (!kunci || !KATA_KUNCI[kunci] && !PERPUSTAKA[kunci] && !BLOK_KOMENTAR[kunci] && !POLA_KHUSUS[kunci]) {
      return asal.map(escapeHTML);
    }
    const { daftar, re } = bangunAturan(kunci);
    re.lastIndex = 0;
    const keluaran = [];
    let simpan = '';
    const tumpuk = (potongan) => {
      simpan += potongan;
      let batas = simpan.indexOf('\n');
      while (batas !== -1) {
        keluaran.push(simpan.slice(0, batas));
        simpan = simpan.slice(batas + 1);
        batas = simpan.indexOf('\n');
      }
    };
    const teks = String(kode == null ? '' : kode);
    let indeks = 0;
    let penjaga = 0;
    while (indeks < teks.length && penjaga < 200000) {
      penjaga += 1;
      re.lastIndex = indeks;
      const cocok = re.exec(teks);
      if (!cocok || cocok.index !== indeks || !cocok[0].length) {
        tumpuk(escapeHTML(teks[indeks]));
        indeks += 1;
        continue;
      }
      let jenis = '';
      for (let i = 0; i < daftar.length; i += 1) {
        if (cocok.groups && cocok.groups[`k${i}`] !== undefined) { jenis = daftar[i].n; break; }
      }
      const potongan = cocok[0];
      tumpuk(!jenis || TANPA_SPAN.has(jenis)
        ? escapeHTML(potongan)
        : `<span class="c-${jenis}">${escapeHTML(potongan)}</span>`);
      indeks += potongan.length;
    }
    tumpuk('');
    if (simpan) keluaran.push(simpan);
    while (keluaran.length < asal.length) keluaran.push('');
    return keluaran.slice(0, Math.max(asal.length, keluaran.length));
  }

  // -------------------------------------------------------------- tautan

  function tautanAman(url) {
    const mentah = String(url || '').trim().replace(/\s+/g, '%20');
    if (/^(?:https?:|mailto:|tel:|#)/i.test(mentah)) return mentah.slice(0, 700);
    if (/^\/[\w./-]*$/.test(mentah)) return mentah;
    if (/^[\w./-]+\.(?:html?|pdf|png|jpe?g|gif|svg|webp|csv|xlsx?|docx?|pptx?)$/i.test(mentah)) return mentah;
    return '';
  }

  /**
   * Baris → HTML inline. Placeholder ASCII dipakai supaya teks yang sudah
   * dihasilkan (tautan, kode sebaris, matematika) tidak ikut diproses aturan
   * berikutnya — inilah yang menjaga tabel dan blok kode tidak rusak.
   */
  function inlineMark(teks, konteks) {
    const nilai = [];
    const simpan = (html) => {
      nilai.push(html);
      return `\u0001${nilai.length - 1}\u0002`;
    };

    let keluaran = escapeHTML(teks);

    keluaran = keluaran.replace(/\\([\\`*_{}\[\]()#+\-.!>~|$])/g, (m, tanda) => simpan(escapeHTML(tanda)));
    keluaran = keluaran.replace(/`([^`\n]{1,400})`/g, (m, isi) => simpan(`<code class="tanya-inline-kode">${isi}</code>`));
    keluaran = keluaran.replace(/\$\$([^\s][^$\n]{0,300}?)\$\$/g, (m, isi) => simpan(matematikaKan(isi)));
    keluaran = keluaran.replace(/(^|[^\w$])\$([^$\n]{1,200})\$(?![\w$])/g, (m, awalan, isi) =>
      `${awalan}${simpan(matematikaKan(isi))}`);

    const gambar = [];
    keluaran = keluaran.replace(/!\[([^\]\n]{0,160})\]\(((?:[^()\s]|\([^)\n]{0,80}\)){1,300})(?:[ \t]+&quot;[^)&]*&quot;)?\)/g, (m, alt, url) => {
      const aman = tautanAman(url);
      if (!aman) return escapeHTML(alt);
      gambar.push(`<figure class="tanya-gambar"><img src="${escapeHTML(aman)}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer">`
        + `${alt ? `<figcaption>${alt}</figcaption>` : ''}</figure>`);
      return `\u0005${gambar.length - 1}\u0006`;
    });

    keluaran = keluaran.replace(/\[([^\]\n]{1,200})\]\(((?:[^()\s]|\([^)\n]{0,120}\)){1,400})(?:[ \t]+&quot;[^)&]*&quot;)?\)/g, (m, label, url) => {
      const aman = tautanAman(url);
      const luar = /^https?:/i.test(aman);
      return simpan(aman
        ? `<a href="${escapeHTML(aman)}"${luar ? ' target="_blank" rel="nofollow noopener noreferrer"' : ''}>${label}</a>`
        : label);
    });

    keluaran = keluaran.replace(/\[(\d{1,3})\]/g, (m, nomor) => simpan(catatan(nomor, konteks)));

    keluaran = keluaran.replace(/\[\^([^\]\n]{1,24})\]/g, (m, id) => {
      const nomor = konteks.namaKaki.get(id);
      if (!nomor) return m;
      return simpan(catatanNomor(nomor, id));
    });

    keluaran = keluaran.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<>"'）)\]]{4,300})/gi, (m, awalan, mentah) => {
      const href = /^https:\/\//i.test(mentah) ? mentah : `https://${mentah}`;
      return `${awalan}${simpan(`<a href="${escapeHTML(href)}" target="_blank" rel="nofollow noopener noreferrer">${mentah.replace(/^https?:\/\//, '')}</a>`)}`;
    });
    keluaran = keluaran.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]{2,})+/g, (surel) =>
      simpan(`<a href="mailto:${surel}">${surel}</a>`));

    keluaran = keluaran.replace(/\*\*\*\*([^*\n]{1,200})\*\*\*\*/g, '<b><i>$1</i></b>');
    keluaran = keluaran.replace(/\*\*([^*\n]{1,300})\*\*/g, '<b>$1</b>');
    keluaran = keluaran.replace(/(^|[^*\w])\*([^*\n]{1,300})\*/g, '$1<i>$2</i>');
    keluaran = keluaran.replace(/(^|[^_\w])__([^_\n]{1,300})__(?![\w_])/g, '$1<b>$2</b>');
    keluaran = keluaran.replace(/(^|[^_\w])_([^_\n]{1,300})_(?![\w_])/g, '$1<i>$2</i>');
    keluaran = keluaran.replace(/~~([^~\n]{1,300})~~/g, '<del>$1</del>');
    keluaran = keluaran.replace(/\+\+([^+\n]{1,300})\+\+/g, '<ins>$1</ins>');
    keluaran = keluaran.replace(/&lt;u&gt;([^<\n]{1,300})&lt;\/u&gt;/g, '<ins>$1</ins>');

    keluaran = keluaran.replace(/\u0001(\d+)\u0002/g, (m, nomor) => nilai[Number(nomor)] ?? '');
    keluaran = keluaran.replace(/\u0005(\d+)\u0006/g, (m, nomor) => gambar[Number(nomor)] ?? '');
    return keluaran;
  }

  function catatanNomor(nomor, id) {
    return `<sup class="tanya-cat" id="tanya-cat-${escapeHTML(String(nomor))}-${escapeHTML(String(id))}">`
      + `<a href="#tanya-cat-kini-${escapeHTML(String(nomor))}" aria-label="Lihat catatan ${nomor}">${nomor}</a></sup>`;
  }

  function catatan(nomor, konteks) {
    if (konteks.kaki.has(String(nomor))) return catatanNomor(String(nomor), String(nomor));
    return `<sup class="tanya-rujukan">${escapeHTML(String(nomor))}</sup>`;
  }

  // ------------------------------------------------------------ matematika

  const SIMBOL = {
    times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥',
    neq: '≠', ne: '≠', approx: '≈', equiv: '≡', propto: '∝', sim: '∼', simdot: '≀',
    infty: '∞', partial: '∂', nabla: '∇', sum: '∑', prod: '∏', int: '∫', iint: '∬',
    oint: '∮', sqrt: '√', angle: '∠', perp: '⊥', parallel: '∥', therefore: '∴',
    because: '∵', circ: '∘', degree: '°', to: '→', rightarrow: '→', leftarrow: '←',
    Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔', mapsto: '↦', in: '∈',
    notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇',
    cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃',
    neg: '¬', land: '∧', lnot: '¬', lor: '∨', alpha: 'α', beta: 'β', gamma: 'γ',
    Gamma: 'Γ', delta: 'δ', Delta: 'Δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ',
    eta: 'η', theta: 'θ', Theta: 'Θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
    lambda: 'λ', Lambda: 'Λ', mu: 'μ', nu: 'ν', xi: 'ξ', Xi: 'Ξ', pi: 'π', Pi: 'Π',
    rho: 'ρ', sigma: 'σ', Sigma: 'Σ', tau: 'τ', upsilon: 'υ', phi: 'φ', Phi: 'Φ',
    varphi: 'ϕ', chi: 'χ', psi: 'ψ', Psi: 'Ψ', omega: 'ω', Omega: 'Ω', hbar: 'ℏ',
    ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', quad: ' ', qquad: '  ', ldots: '…', cdots: '⋯',
    dots: '…', prime: '′', percent: '%', dagger: '†', checkmark: '✓',
  };

  const POLA_PERINTAH = new RegExp(`\\\\(?:${Object.keys(SIMBOL).sort((a, b) => b.length - a.length).join('|')})(?![A-Za-z])`, 'g');

  /** Semua teks di-escape, kecuali placeholder \u0004n\u0005 yang sudah HTML jadi. */
  function escapeKecualiTanda(teks) {
    return String(teks).split(/(\u0004\d+\u0005)/)
      .map((bagian) => (/^\u0004\d+\u0005$/.test(bagian) ? bagian : escapeHTML(bagian)))
      .join('');
  }

  /**
   * Subset LaTeX yang cukup untuk rumus sehari-hari: pangkat, pecahan, akar,
   * simbol Yunani dan operator. Sengaja tanpa KaTeX supaya tidak ada berkas
   * beberapa ratus kilobyta yang harus diunduh kader.
   */
  function matematikaKan(sumber) {
    let teks = String(sumber || '');
    const nilai = [];
    const simpan = (html) => { nilai.push(html); return `\u0004${nilai.length - 1}\u0005`; };

    teks = teks.replace(/\\(?:left|right|bigg?[lr]?|Bigg?[lr]?|displaystyle|limits|nolimits|mathopen|mathclose)\s?/g, '');
    teks = teks.replace(/\\(?:begin|end)\s*\{[^{}]*\}/g, ' ');
    teks = teks.replace(POLA_PERINTAH, (m) => simpan(escapeHTML(SIMBOL[m.slice(1)])));
    teks = teks.replace(/\\(?:text|textrm|textbf|textit|mathrm|mathit|mathbf|mathsf|operatorname|emph)\s*\{([^{}]*)\}/g, (m, isi) => {
      const buka = /textbf|mathbf/.test(m) ? '<b>' : /textit|mathit|emph/.test(m) ? '<i>' : '';
      const tutup = buka ? (buka === '<b>' ? '</b>' : '</i>') : '';
      return `${buka ? simpan(buka) : ''}${isi}${tutup ? simpan(tutup) : ''}`;
    });
    teks = teks.replace(/\\(?:hat|widehat|tilde|check)\s*\{([^{}]*)\}/g, (m, isi) =>
      simpan(escapeHTML(`${isi}${m.includes('tilde') ? '\u0303' : m.includes('check') ? '\u030C' : '\u0302'}`)));
    teks = teks.replace(/\\(?:bar|overline|overrightarrow|vec)\s*\{([^{}]*)\}/g, (m, isi) =>
      simpan(`<span class="tanya-bar">${escapeHTML(isi)}</span>`));
    teks = teks.replace(/\\(?:d?frac|d?binom|tfrac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (m, atas, bawah) =>
      simpan(`<span class="tanya-pecahan${/binom/.test(m) ? ' is-binom' : ''}">`
        + `<span class="tanya-pecahan-atas">${escapeHTML(atas)}</span>`
        + `<span class="tanya-pecahan-bawah">${escapeHTML(bawah)}</span></span>`));
    teks = teks.replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, (m, tingkat, isi) =>
      simpan(`<sup class="tanya-akar-tingkat">${escapeHTML(tingkat)}</sup><span class="tanya-akar">${escapeHTML(isi)}</span>`));
    teks = teks.replace(/\\sqrt\s*\{([^{}]*)\}/g, (m, isi) =>
      simpan(`<span class="tanya-akar">${escapeHTML(isi)}</span>`));
    teks = teks.replace(/\\([%&_#{}$])|\\([,;:!s])|\\([A-Za-z]+)|\\([^\w\\])/g, (m, tanda, jarak, nama, lain) =>
      tanda || jarak || nama || lain || '');

    teks = escapeKecualiTanda(teks)
      .replace(/\^\s*\{([^{}]+)\}/g, '<sup>$1</sup>')
      .replace(/_\s*\{([^{}]+)\}/g, '<sub>$1</sub>')
      .replace(/\^\s*([A-Za-z0-9'+\-])/g, '<sup>$1</sup>')
      .replace(/_\s*([A-Za-z0-9'-]+)/g, '<sub>$1</sub>');

    return `<span class="tanya-matematika">${teks
      .replace(/\u0004(\d+)\u0005/g, (m, nomor) => nilai[Number(nomor)] ?? '')}</span>`;
  }

  // ---------------------------------------------------------------- blok

  const POLA_JUDUL = /^(#{1,6})[ \t]+(.+?)[ \t]*#*$/;
  const POLA_GARIS = /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:=[ \t]*){3,}|(?:#[ \t]*){3,}|(?:\+[ \t]*){3,})$/;
  const POLA_BUTIR = /^([ \t]*)([-*+][ \t]+|\d{1,9}[.)][ \t]+)(.*)$/;
  const POLA_KOTAK = /^\[([ xX])\][ \t]+(.*)$/;
  const POLA_FENCE = /^[ \t]*(`{3,}|~{3,})[ \t]*([^`\n]*)$/;
  const POLA_KAKI = /^[ \t]*\[\^([^\]\n]{1,24})\]:[ \t]*(.*)$/;

  function pisahSel(baris) {
    const teks = String(baris).trim().replace(/\\\|/g, '\u0000');
    const hasil = [];
    let kini = '';
    let kod = false;
    for (const karakter of teks) {
      if (karakter === '`') kod = !kod;
      if (karakter === '|' && !kod) { hasil.push(kini); kini = ''; continue; }
      kini += karakter;
    }
    hasil.push(kini);
    if (hasil.length > 1 && !hasil[0].trim() && !hasil[hasil.length - 1].trim()) {
      hasil.shift();
      hasil.pop();
    }
    return hasil.map((sel) => sel.replace(/\u0000/g, '|').trim());
  }

  const pemisahSel = (baris) => {
    if (!String(baris).includes('|') || !String(baris).includes('-')) return false;
    const isi = pisahSel(baris);
    return isi.length > 0 && isi.every((sel) => /^:?-{2,}:?$/.test(sel.replace(/\s/g, '')));
  };

  const penyelarasan = (baris) => pisahSel(baris).map((sel) => {
    const t = sel.trim();
    if (/^:-+:$/.test(t)) return 'center';
    if (/^-+:$/.test(t)) return 'right';
    if (/^:-+$/.test(t)) return 'left';
    return '';
  });

  const ANGKA = /^[-+]?[$€£]?[\d][\d.,\s*/×x:-]*\s*(?:%|[a-zA-Zµ°]{1,6})?$/;

  function kolomAngka(baris) {
    return ANGKA.test(String(baris).replace(/\*\*|\`/g, '').trim());
  }

  function tabelHTML(kepala, pemisah, badan, konteks) {
    const selKepala = pisahSel(kepala);
    const arah = penyelarasan(pemisah);
    const barisBadan = badan.map(pisahSel);
    const jumlah = selKepala.length;
    const angka = selKepala.map((_, i) => barisBadan.every((sel) => !sel[i] || kolomAngka(sel[i])));
    const gaya = (i) => {
      const r = arah[i] || (angka[i] && i > 0 ? 'right' : '');
      return r ? ` class="is-${r}"` : '';
    };
    const judul = selKepala.map((sel, i) => `<th scope="col"${gaya(i)}>${inlineMark(sel, konteks)}</th>`).join('');
    const isi = barisBadan.map((sel) => `<tr>${sel
      .map((satu, i) => `<td${gaya(i)}>${inlineMark(satu, konteks)}</td>`).join('')}</tr>`).join('');
    const lebar = Math.max(1, jumlah);
    return `<div class="tanya-tabel-lapit" tabindex="0" role="region" aria-label="Tabel, gulir horizontal bila sempit">`
      + `<table class="tanya-tabel is-${lebar}"><thead><tr>${judul}</tr></thead><tbody>${isi}</tbody></table></div>`;
  }

  // -------------------------------------------------------------- terminal

  const PS_SHELL = /^[ \t]*(?:(?:\S+@\S+[\\ ~/#$][#$])|(?:\(\S+\)[ \t]*)?[$#>])[ \t]+(\S.*)$/;
  const PS_POWERSHELL = /^[ \t]*(?:PS(?:[ \t]+[A-Za-z]:[^\s>]*)?(?:[ \t]*\[[^\]]*\])?|[A-Za-z]:[^\s>]*)[ \t]*>[ \t]+(\S.*)$/;
  const PS_GENERIC = /^[ \t]{0,2}(?:\$[ \t]|PS>[ \t]|[>][ \t])(\S.*)$/;
  const LANJUTAN = /^[ \t]+(?:[-/\\.]|if|then|do|\||&)[\s\S]*$/;
  const POLA_GAGAL = /(?:\b(?:error|errors|err|failed|failure|fatal|exception|traceback|panic|unrecognized|unsupported|invalid|denied|not found|no such|cannot|could not|unauthorized|forbidden|timed out|exited with code)\b|!\d{3,}|exit code [1-9]|npm ERR!|⚠|✗|✖)/i;
  const POLA_PERINGATAN = /(?:\b(?:warn(?:ing)?|deprecated|caution|suspicious)\b|⚠)/i;
  const POLA_SUKSES = /(?:\b(?:success(?:ful)?|passed|done|complete(?:d)?|up to date|already exists|created|installed|connected|ok\b)\b|✓)/i;

  function potonganTerminal(baris, kunci) {
    const ps = kunci === 'ps1' ? PS_POWERSHELL : kunci === 'bat' ? PS_GENERIC : PS_SHELL;
    const berprompt = baris.some((satu) => ps.test(satu) || PS_POWERSHELL.test(satu) || PS_GENERIC.test(satu));
    if (!berprompt) return [];
    const potongan = [];
    let kini = null;
    for (const satu of baris) {
      const cocok = ps.exec(satu) || PS_POWERSHELL.exec(satu) || PS_GENERIC.exec(satu);
      if (cocok && cocok[1]) {
        kini = { jenis: 'perintah', teks: [cocok[1].trim()], simbol: String(satu).slice(0, cocok[1].length ? satu.indexOf(cocok[1]) : 0).trim() };
        potongan.push(kini);
        continue;
      }
      if (kini && LANJUTAN.test(satu) && /(?:\\|\^|\||`)$/.test(kini.teks[kini.teks.length - 1])) {
        kini.teks.push(satu.trim());
        continue;
      }
      kini = null;
      potongan.push({ jenis: 'keluaran', teks: [satu] });
    }
    return potongan;
  }

  /** Blok shell yang tidak memakai tanda prompt: baris pertama dianggap perintah. */
  function potonganimplisit(baris) {
    const pertama = String(baris[0] || '').trim();
    if (!pertama || /^\s/.test(baris[0])) return null;
    if (/(?:[;{}]\s*$|^\s*(?:if|for|while|function|case|switch|begin|try)\b)/i.test(pertama)) return null;
    const kata = pertama.split(/\s+/)[0].replace(/^['"`]|\[[^\]]*\]$/g, '');
    if (!/^[A-Za-z][\w.+-]{0,29}$/.test(kata) || /^(?:echo|printf|note|output|hasil|contoh)$/.test(kata)) {
      if (baris.length > 1) return null;
    }
    return [{ jenis: 'perintah', teks: [pertama], simbol: '$' }]
      .concat(baris.slice(1).map((satu) => ({ jenis: 'keluaran', teks: [satu] })));
  }

  function terminalHTML(baris, kunci, konteks) {
    const potongan = potonganTerminal(baris, kunci);
    const daftar = potongan.length ? potongan : (potonganimplisit(baris) || []);
    if (!daftar.some((satu) => satu.jenis === 'perintah')) return null;

    const keluaran = [];
    const salinPerintah = [];
    const salinKeluaran = [];
    for (const satu of daftar) {
      const teks = satu.jenis === 'perintah'
        ? satu.teks.join(' ').replace(/\s*\\\s*/g, ' ').replace(/\s*\^\s*/g, ' ').replace(/\s*\|\s*$/, ' |').trim()
        : satu.teks[0];
      if (satu.jenis === 'perintah') {
        salinPerintah.push(teks);
        const prompt = String(satu.simbol || '');
        const glyph = /#$/.test(prompt.trim()) ? '#'
          : kunci === 'ps1' ? 'PS>' : kunci === 'bat' ? 'C:>' : '$';
        keluaran.push(`<div class="tanya-term-baris is-perintah"><span class="tanya-term-ps" aria-hidden="true">`
          + `${escapeHTML(glyph)}</span>`
          + `<code class="tanya-term-kode">${escapeHTML(teks)}</code></div>`);
      } else {
        const kelas = POLA_GAGAL.test(teks) ? ' is-gagal'
          : POLA_PERINGATAN.test(teks) ? ' is-waspad'
            : POLA_SUKSES.test(teks) ? ' is-beres' : '';
        if (/\S/.test(teks)) salinKeluaran.push(teks);
        keluaran.push(`<div class="tanya-term-baris is-keluaran${kelas}">`
          + `<span class="tanya-term-ps is-kosong" aria-hidden="true"></span><span>${escapeHTML(teks)}</span></div>`);
      }
    }
    const judul = NAMA_BAHASA[kunci] || 'Terminal';
    return `<div class="tanya-terminal is-${kunci}" data-perintah="${escapeHTML(salinPerintah.join('\n'))}"`
      + ` data-keluaran="${escapeHTML(salinKeluaran.join('\n'))}"`
      + ` data-kode="${escapeHTML(`${salinPerintah.join('\n')}\n${salinKeluaran.join('\n')}`.trim())}"`
      + ` data-file="${escapeHTML(`tanya-pii-terminal-${kunci}.txt`)}">`
      + `<div class="tanya-terminal-kepala"><span class="tanya-terminal_lampu" aria-hidden="true"><i></i><i></i><i></i></span>`
      + `<span class="tanya-terminal_judul">Terminal · ${escapeHTML(judul)}</span>`
      + `<span class="tanya-terminal_tombol">`
      + `<button type="button" class="tanya-ktombol" data-act="terminal-perintah">Salin Command</button>`
      + `<button type="button" class="tanya-ktombol" data-act="terminal-keluaran">Salin Output</button></span></div>`
      + `<div class="tanya-terminal-badan">${keluaran.join('')}</div></div>`;
  }

  function kodeHTML(baris, label, kunci, konteks) {
    const daftar = BAHASA_TERMINAL.has(kunci) && !/^(?:text|txt|plain)$/i.test(label || '')
      ? terminalHTML(baris, kunci, konteks) : null;
    if (daftar) return daftar;

    const panjang = baris.length;
    const perbaris = sorot(baris.join('\n'), kunci);
    const nomor = panjang > 1 && panjang <= 400;
    const isi = perbaris
      .map((satu) => `<span class="tanya-baris-kode">${satu || ' '}</span>`)
      .join('');
    const lipat = panjang > LIPAT_BARIS;
    const nama = `tanya-pii-${(kunci || 'kode').replace(/[^\w-]/g, '') || 'kode'}.${EKTENSI[kunci] || 'txt'}`;
    const tombol = `<span class="tanya-sorot_tombol">`
      + `<button type="button" class="tanya-ktombol" data-act="kode-salin">Salin Kode</button>`
      + `<button type="button" class="tanya-ktombol" data-act="kode-unduh">Unduh Kode</button></span>`;
    return `<div class="tanya-sorot is-${escapeHTML(kunci || 'polos')}${lipat ? ' is-lipat' : ''}"`
      + ` data-kode="${escapeHTML(baris.join('\n'))}" data-file="${escapeHTML(nama)}" data-baris="${panjang}">`
      + `<div class="tanya-sorot-kepala"><span class="tanya-sorot_bahasa">${escapeHTML(namaBahasa(kunci))}</span>`
      + `<span class="tanya-sorot_meta">${panjang} baris</span>${tombol}</div>`
      + `<div class="tanya-sorot-badan"><pre class="tanya-kode${nomor ? ' is-nomor' : ''}">`
      + `<code class="tanya-kode-isi">${isi}</code></pre></div>`
      + `${lipat ? `<button type="button" class="tanya-sorot-bentang" data-act="kode-bentang">Tampilkan semua ${panjang} baris</button>` : ''}</div>`;
  }

  // ------------------------------------------------------------- blok utama

  function renderBlok(baris, konteks) {
    const keluaran = [];
    let i = 0;
    const total = baris.length;

    while (i < total) {
      const satu = baris[i];

      if (kosong(satu)) { i += 1; continue; }

      const fence = POLA_FENCE.exec(satu);
      if (fence) {
        const penanda = fence[1][0];
        const panjang = fence[1].length;
        const label = String(fence[2] || '').split(/[\s:=,]+/)[0].toLowerCase();
        const kunci = kunciBahasa(label);
        const isi = [];
        i += 1;
        while (i < total) {
          const penutup = new RegExp(`^[ \\t]*\\${penanda}{${panjang},}[ \\t]*$`).test(baris[i]);
          const beda = POLA_FENCE.exec(baris[i]);
          if (penutup || (beda && beda[1][0] === penanda && beda[1].length >= panjang)) { i += 1; break; }
          isi.push(baris[i]);
          i += 1;
        }
        if (!isi.length) { i += 0; continue; }
        keluaran.push(kodeHTML(isi, label, kunci, konteks));
        continue;
      }

      if (/^[ \t]*\$\$[ \t]*$/.test(satu)) {
        const isi = [];
        i += 1;
        while (i < total && !/[ \t]*\$\$[ \t]*$/.test(baris[i])) { isi.push(baris[i]); i += 1; }
        if (i < total) i += 1;
        keluaran.push(`<div class="tanya-matematika-blok">${matematikaKan(isi.join(' '))}</div>`);
        continue;
      }

      const kaki = POLA_KAKI.exec(satu);
      if (kaki) {
        const id = kaki[1].trim();
        const teks = [kaki[2]];
        i += 1;
        while (i < total && !kosong(baris[i]) && !POLA_KAKI.test(baris[i]) && indentLebar(baris[i]) >= 2) {
          teks.push(potongIndent(baris[i], 2));
          i += 1;
        }
        konteks.kaki.set(id, teks.join(' '));
        if (!konteks.namaKaki.has(id)) konteks.namaKaki.set(id, konteks.urutan += 1);
        continue;
      }

      const judul = POLA_JUDUL.exec(satu.trim());
      if (judul) {
        const tingkat = Math.min(6, judul[1].length + 1);
        keluaran.push(`<h${tingkat} class="tanya-h tanya-h${tingkat}">${inlineMark(judul[2], konteks)}</h${tingkat}>`);
        i += 1;
        continue;
      }

      const garisBawah = !kosong(baris[i + 1] || '') && JUDUL_GANDA.test(String(baris[i + 1]).trim());
      if (garisBawah && !kosong(satu) && !pemisahSel(String(baris[i + 1]).trim())) {
        const tingkat = String(baris[i + 1]).trim()[0] === '=' ? 2 : 3;
        keluaran.push(`<h${tingkat} class="tanya-h tanya-h${tingkat}">${inlineMark(satu.trim(), konteks)}</h${tingkat}>`);
        i += 2;
        continue;
      }

      if (POLA_GARIS.test(satu.trim())) {
        keluaran.push('<hr class="tanya-garis">');
        i += 1;
        continue;
      }

      if (/^[ \t]{0,3}>/.test(satu)) {
        const isi = [];
        while (i < total) {
          if (/^[ \t]{0,3}>/.test(baris[i])) { isi.push(baris[i].replace(/^[ \t]{0,3}>[ \t]?/, '')); i += 1; continue; }
          if (!kosong(baris[i]) && !POLA_BUTIR.test(baris[i]) && !POLA_JUDUL.test(baris[i].trim())
            && indentLebar(baris[i]) < 4) { isi.push(baris[i].trim()); i += 1; continue; }
          break;
        }
        keluaran.push(`<blockquote class="tanya-kutipan">${renderBlok(isi, konteks)}</blockquote>`);
        continue;
      }

      if (satu.includes('|') && i + 1 < total && pemisahSel(String(baris[i + 1]).trim())) {
        const kepala = satu;
        const pemisah = String(baris[i + 1]).trim();
        const badan = [];
        i += 2;
        while (i < total && baris[i].includes('|') && !kosong(baris[i]) && !pemisahSel(baris[i].trim())) {
          badan.push(baris[i]);
          i += 1;
        }
        keluaran.push(tabelHTML(kepala, pemisah, badan, konteks));
        continue;
      }

      if (POLA_BUTIR.test(satu)) {
        const awal = indentLebar(satu);
        const kelompok = [];
        while (i < total) {
          const cocok = POLA_BUTIR.exec(baris[i]);
          const berlekuk = cocok && kelompok.length && indentLebar(baris[i]) > awal;
          if (cocok && !berlekuk && indentLebar(baris[i]) >= awal) {
            const lebar = cocok[1].replace(/\t/g, '  ').length + cocok[2].length;
            kelompok.push({ indent: indentLebar(baris[i]), penanda: cocok[2], isi: [cocok[3]], lebar });
            i += 1;
            continue;
          }
          if (kosong(baris[i])) {
            const berikut = baris[i + 1];
            if (berikut && (POLA_BUTIR.test(berikut) || indentLebar(berikut) > awal)) {
              if (kelompok.length) kelompok[kelompok.length - 1].isi.push('');
              i += 1;
              continue;
            }
            break;
          }
          if (kelompok.length && indentLebar(baris[i]) > awal) {
            const induk = kelompok[kelompok.length - 1];
            induk.isi.push(potongIndent(baris[i], Math.min(induk.lebar, indentLebar(baris[i]))));
            i += 1;
            continue;
          }
          if (kelompok.length && /^\s+\S/.test(baris[i]) && !POLA_JUDUL.test(baris[i].trim())) {
            kelompok[kelompok.length - 1].isi.push(baris[i].trim());
            i += 1;
            continue;
          }
          break;
        }
        keluaran.push(daftarHTML(kelompok, konteks));
        continue;
      }

      if (/^[ \t]{4,}\S/.test(satu)) {
        const isi = [];
        while (i < total && (/^[ \t]{4,}\S/.test(baris[i]) || kosong(baris[i]))) {
          if (POLA_FENCE.test(baris[i])) break;
          isi.push(potongIndent(baris[i], 4));
          i += 1;
        }
        while (isi.length && kosong(isi[isi.length - 1])) isi.pop();
        keluaran.push(kodeHTML(isi, '', 'txt', konteks));
        continue;
      }

      const paragraf = [];
      while (i < total) {
        const kini = baris[i];
        if (kosong(kini)) break;
        if (POLA_FENCE.test(kini) || POLA_JUDUL.test(kini.trim()) || POLA_BUTIR.test(kini)
          || /^[ \t]{0,3}>/.test(kini) || POLA_GARIS.test(kini.trim()) || POLA_KAKI.test(kini)
          || /^[ \t]*\$\$[ \t]*$/.test(kini)) break;
        if (kini.includes('|') && i + 1 < total && pemisahSel(String(baris[i + 1] || '').trim())) break;
        paragraf.push(kini.trim());
        i += 1;
      }
      const teks = paragraf.join('\n');
      const rapal = teks.split('\n').map((satu2) => inlineMark(satu2, konteks)).join('<br>');
      keluaran.push(`<p class="tanya-para">${rapal}</p>`);
    }
    return keluaran.join('');
  }

  const JUDUL_GANDA = /^(?:={3,}|-{3,})$/;

  /** Paragraf pertama butir jadi teks satu baris; sisanya (daftar/daftar anak) tetap blok. */
  function isiButir(barisIsi, konteks) {
    const teks = renderBlok(barisIsi, konteks);
    const cocok = /^<p class="tanya-para">([\s\S]*?)<\/p>/.exec(teks);
    if (!cocok) return teks;
    return `<span class="tanya-butir-teks">${cocok[1]}</span>${teks.replace(cocok[0], '')}`;
  }

  function daftarHTML(kelompok, konteks) {
    let hasil = '';
    let jenis = '';
    let buka = false;
    const tutupSemua = () => {
      if (!buka) return;
      hasil += jenis === 'ol' ? '</ol>' : '</ul>';
      buka = false;
    };
    const mulai = (nama) => {
      if (buka && jenis === nama) return;
      tutupSemua();
      const tag = nama === 'ol' ? 'ol' : 'ul';
      hasil += `<${tag} class="tanya-daf${nama === 'ol' ? ' is-urut' : ''}${nama === 'task' ? ' is-cek' : ''}">`;
      jenis = nama;
      buka = true;
    };

    for (const butir of kelompok) {
      const kotak = POLA_KOTAK.exec(butir.isi[0] || '');
      const nomor = /^\d/.test(butir.penanda);
      mulai(kotak ? 'task' : nomor ? 'ol' : 'ul');
      if (!kotak) {
        hasil += `<li class="tanya-butir">${isiButir(butir.isi, konteks)}</li>`;
        continue;
      }
      const geser = butir.penanda.length + 4;
      const isi = [kotak[2]].concat(butir.isi.slice(1).map((satu) => potongIndent(satu, geser)));
      hasil += `<li class="tanya-butir is-cek"><span class="tanya-kotak is-${kotak[1] === ' ' ? 'kosong' : 'isi'}"`
        + ` role="img" aria-label="${kotak[1] === ' ' ? 'Belum selesai' : 'Selesai'}"></span>`
        + `${isiButir(isi, konteks)}</li>`;
    }
    tutupSemua();
    return hasil;
  }

  function catatanAkhir(konteks) {
    if (!konteks.kaki.size) return '';
    const butir = [...konteks.kaki.entries()]
      .sort((a, b) => (konteks.namaKaki.get(a[0]) || 99) - (konteks.namaKaki.get(b[0]) || 99))
      .map(([id, teks]) => `<li id="tanya-cat-kini-${escapeHTML(String(konteks.namaKaki.get(id) || ''))}">`
        + `${inlineMark(teks, konteks)}</li>`)
      .join('');
    return `<aside class="tanya-catat"><p class="tanya-catat_judul">Catatan</p><ol class="tanya-catat-daf">${butir}</ol></aside>`;
  }

  // ----------------------------------------------------------------- publik

  function render(markdown, opsi) {
    const konteks = {
      kaki: new Map(), namaKaki: new Map(), urutan: 0,
      judul: Boolean(opsi && opsi.judul),
    };
    const teks = String(markdown === null || markdown === undefined ? '' : markdown)
      .replace(/\t\n/g, '\n').replace(/\r\n?/g, '\n');
    const baris = teks.split('\n');
    /*
     * Nomor catatan kaki ditetapkan sebelum paragraf dirender: sering kali
     * definisinya baru muncul di akhir jawaban, sedangkan penanda [^1] sudah
     * dipakai di kalimat pertama.
     */
    for (const satu of baris) {
      const cocok = POLA_KAKI.exec(satu);
      if (cocok && !konteks.namaKaki.has(cocok[1].trim())) {
        konteks.namaKaki.set(cocok[1].trim(), konteks.urutan += 1);
      }
    }
    const html = renderBlok(baris, konteks);
    const kaki = catatanAkhir(konteks);
    return `<div class="tanya-tulis"${kaki ? ' data-catatan="1"' : ''}>${html}${kaki}</div>`;
  }

  /** Teks polos untuk berkas .txt: struktur dipertahankan, tanda Markdown dibuang. */
  function toPlainText(markdown) {
    const baris = BARIS(markdown);
    const hasil = [];
    let diDalamKode = false;
    for (let satu of baris) {
      if (POLA_FENCE.test(satu)) { diDalamKode = !diDalamKode; hasil.push(''); continue; }
      if (diDalamKode) { hasil.push(`    ${satu}`); continue; }
      const potong = String(satu).trim();
      if (!potong) { if (hasil.length && hasil[hasil.length - 1] !== '') hasil.push(''); continue; }
      const judul = POLA_JUDUL.exec(potong);
      if (judul) { hasil.push(`${judul[2].toUpperCase()}`, `${'-'.repeat(Math.min(60, judul[2].length * 2))}`); continue; }
      if (POLA_GARIS.test(potong)) { hasil.push('-'.repeat(48)); continue; }
      if (/^[ \t]{0,3}>/.test(satu)) { hasil.push(`    ${potong.replace(/^>+/g, '').trim()}`); continue; }
      const butir = POLA_BUTIR.exec(satu);
      if (butir) {
        const kotak = POLA_KOTAK.exec(butir[3]);
        const takuk = '  '.repeat(Math.max(0, Math.floor(butir[1].replace(/\t/g, '  ').length / 2)));
        const penanda = kotak ? (kotak[1] === 'x' ? '[v]' : '[ ]')
          : /^\d/.test(butir[2]) ? `${butir[2].trim()}` : '-';
        hasil.push(`${takuk}  ${penanda} ${bersihInline(kotak ? kotak[2] : butir[3])}`.replace(/ {2,}$/gm, ''));
        continue;
      }
      if (pemisahSel(potong)) continue;
      hasil.push(bersihInline(potong).replace(/\u0000/g, '|'));
    }
    return hasil.join('\n')
      .replace(/ {2,}$/gm, '')
      .trim();
  }

  function bersihInline(teks) {
    return String(teks)
      .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (m, alt, url) => `${alt || 'Gambar'}: ${url}`)
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '$1 ($2)')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/\+\+([^+]+)\+\+/g, '$1')
      .replace(/\[\^([^\]]+)\]/g, '[$1]')
      .replace(/\\([\\`*_{}\[\]()#+\-.!>~|$])/g, '$1');
  }

  window.PBPIIMarkdown = {
    render,
    toPlainText,
    sorot,
    escapeHTML,
    kunciBahasa,
    namaBahasa,
    tautanAman,
    BAHASA_TERMINAL,
    EKTENSI,
  };
})();
