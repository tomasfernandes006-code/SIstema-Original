// Importa o cliente do Supabase direto do CDN (ESM).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// Configuração do projeto Supabase.
//
// Observação: o createClient espera apenas a URL BASE do projeto
// (https://<projeto>.supabase.co). O caminho do PostgREST (/rest/v1/) é
// adicionado automaticamente pelo próprio SDK em cada requisição, por isso
// ele NÃO deve fazer parte da URL informada aqui.
const supabaseUrl = "https://mbectpiohzcsoeguvqyd.supabase.co";

// Chave pública (publishable/anon) do projeto.
const supabaseKey = "sb_publishable_x5s34cGpx3UYk2edqKMxkA_Qz2OlTLS";

// Instância do Supabase exportada para ser usada nos outros arquivos:
//   import { supabase } from "./supabase-config.js";
const supabase = createClient(supabaseUrl, supabaseKey);

export { supabase, supabaseUrl, supabaseKey };
export default supabase;