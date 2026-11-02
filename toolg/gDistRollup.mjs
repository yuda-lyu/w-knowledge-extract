import rollupFiles from 'w-package-tools/src/rollupFiles.mjs'


let fdSrc = './src'
let fdTar = './dist'


//external與globals之盤點原則:
//1. 本套件以src深層引用自有套件(w-knowledge-capture/w-knowledge-summarize/w-knowledge-relate/w-data-pipeline/w-dispatch-ai/w-dwdata-hub/w-fetch-web/w-orm-lmdb/wsemi)之原始碼,
//   rollup會沿著引用打包到其src(經w-knowledge-capture、w-knowledge-summarize、w-knowledge-relate再引用者亦然), 故各自有套件之gDistRollup所剔除者, 在此亦須剔除, 否則會被打包進來;
//2. 本套件src之node內建模組一律以無前綴引用(fs、path、url), 與自有套件同一寫法, 故只需一套剔除規則;
//   rollup之external與globals以import字串逐字比對, 'fs'不涵蓋'node:fs'(實測只列fs時, node:fs出現globals猜名警告,
//   runin為browser時另成未解析引用), 若日後引用node:前綴須另行列入
//3. 本套件直接引用之第三方套件僅json5(src/standards/parse.mjs, 列於dependencies, 比照w-*套件慣例列為external), 另經w-knowledge-capture而達opencc-js, 同樣列為external,
//   由dependencies安裝(w-knowledge-capture之dependencies帶入opencc-js);
//   opencc-js核心含大型轉換表, 打包會使dist暴增; 其詞庫以子路徑引用(opencc-js/dict/*)則不剔除而打包進dist:
//   詞庫為純資料之ESM預設匯出(字串), 套件exports的「./*」只給ESM檔(無require條件), 列為external時UMD經require載入得到的是命名空間物件而非字串,
//   詞庫無法使用(實測載入dist即拋split非函數), 故須打包(約1.1MB, 其中STPhrases占大宗)
//4. dayjs已由wsemi剔除, 其外掛以子路徑引用(dayjs/plugin/utc.js由w-dwdata-hub引用), 須逐一列入, 否則外掛被打包而核心外部化
//5. globals右側為引入後的名稱, 不能包含小數點「.」
//6. runin須為nodejs: 本套件僅能於nodejs執行(lmdb、playwright、child_process), 未給時rollupFiles預設browser,
//   會以browser欄位解析被打包之相依(uuid、crypto-js等取瀏覽器版)並警告依賴node內建模組
//盤點方式: 自src/WKnowledgeExtract.mjs靜態追蹤import圖(含自有套件src深層引用, 含經w-knowledge-capture、w-knowledge-summarize、w-knowledge-relate再引用者)取得全部裸import,
//   再與各自有套件之gDistRollup剔除清單比對, 取圖中確實到達者;
//   圖中被打包而不剔除者為lodash-es/*、crypto-js/*、uuid、eventemitter3(wsemi所引用, 體積小且各自有單函數路徑, 與自有套件之打包一致)、
//   mingo(w-orm-lmdb之reqMingo.js以require引入, 與自有套件之打包一致)與opencc-js/dict/*(見第3點)


rollupFiles({
    fns: 'WKnowledgeExtract.mjs',
    fdSrc,
    fdTar,
    nameDistType: 'kebabCase',
    runin: 'nodejs',
    globals: {

        //node內建模組(本套件與自有套件之剔除清單)
        'path': 'path',
        'fs': 'fs',
        'url': 'url',
        'child_process': 'child_process',
        'crypto': 'crypto',
        'util': 'util',
        'module': 'module',
        'os': 'os',
        'zlib': 'zlib',

        //本套件直接引用及經w-knowledge-capture而達之第三方套件
        'json5': 'JSON5',
        'opencc-js': 'OpenCC',

        //wsemi剔除清單
        'tree-kill': 'treeKill',
        'dayjs': 'dayjs',
        'dayjs/plugin/utc.js': 'dayjs_plugin_utc',

        //w-fetch-web、w-dwdata-hub剔除清單
        '@mozilla/readability': '@mozilla/readability',
        'jsdom': 'jsdom',
        'playwright': 'playwright',
        'rss-parser': 'rss-parser',

        //w-orm-lmdb剔除清單
        'lmdb': 'lmdb',

    },
    external: [

        //node內建模組(本套件與自有套件之剔除清單)
        'path',
        'fs',
        'url',
        'child_process',
        'crypto',
        'util',
        'module',
        'os',
        'zlib',

        //本套件直接引用及經w-knowledge-capture而達之第三方套件
        'json5',
        'opencc-js',

        //wsemi剔除清單
        'tree-kill',
        'dayjs',
        'dayjs/plugin/utc.js',

        //w-fetch-web、w-dwdata-hub剔除清單
        '@mozilla/readability',
        'jsdom',
        'playwright',
        'rss-parser',

        //w-orm-lmdb剔除清單
        'lmdb',

    ],
})


//node toolg/gDistRollup.mjs
