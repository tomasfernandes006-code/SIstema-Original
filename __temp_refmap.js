const _temp = [
  ...(()=>{ const lines = require('fs').readFileSync('c:/Users/itosh/Downloads/Sistema Falso/js/app.js','utf8').split('\n'); const out=[]; let i=-1; for(const l of lines){ i++; if(l.includes('renderizarDashboard')) out.push(`${i+1}: ${l}`) } return out })()
  , '---SEPARADOR---'
  , ...(()=>{ const lines = require('fs').readFileSync('c:/Users/itosh/Downloads/Sistema Falso/js/app.js','utf8').split('\n'); const out=[]; let i=-1; for(const l of lines){ i++; if(l.includes('renderizarOcorrencias') || l.includes('renderizarAtrasos')) out.push(`${i+1}: ${l}`) } return out })()
  , '---SEPARADOR2---'
  , ...(()=>{ const lines = require('fs').readFileSync('c:/Users/itosh/Downloads/Sistema Falso/js/dados.js','utf8').split('\n'); const out=[]; let i=-1; for(const l of lines){ i++; if(l.includes('listarOcorrencias') || l.includes('listarEntradasAtrasadas') || l.includes('aoMudar')) out.push(`${i+1}: ${l}`) } return out })()
];
require('fs').writeFileSync('c:/Users/itosh/Downloads/Sistema Falso/alunos.json','') // não toca, só previne
require('fs').writeFileSync('c:/Users/itosh/AppData/Local/Temp/cl-renderrefs.txt', _temp.join('\n'),'utf8')