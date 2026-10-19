// GestNow Mini: picagem com cartão, obras, trabalhadores, quem está na obra, documentos e mapa de horas.
// Sem passo de compilação: ficheiros estáticos, publicáveis em qualquer alojamento com HTTPS.
'use strict';

const cfg = window.GESTNOW_CONFIG || {};
const app = document.getElementById('app');
const nav = document.getElementById('nav');
const PRIVILEGED = ['admin', 'hr', 'finance', 'hse', 'project_manager'];   // the database asks these roles for MFA (aal2)
const QUEUE_KEY = 'gestnow.queue';          // taps waiting for the network (each with its own id, p_client_event_id)
const REJECTED_KEY = 'gestnow.rejected';    // taps the server refused after the network came back: kept until someone deals with them
const SITE_KEY = 'gestnow.site';
const SITES_KEY = 'gestnow.sites';          // the site list, to open the app without network (no personal data)
const ME_KEY = 'gestnow.me';                // role and company of the last login, to open Picar without network
const CLOCK_KEY = 'gestnow.clock';          // difference between this phone's clock and the server's
const LASTDIR_KEY = 'gestnow.lastDir';      // last direction per card (hashed), for the automatic direction without network

const REASONS = {
  unknown_credential: 'Cartão desconhecido',
  debounce: 'Já picou há instantes',
  collaborator_inactive: 'Trabalhador inativo',
  onboarding_incomplete: 'Acolhimento incompleto',
  project_not_in_execution: 'A obra não está em execução',
  suspended_safety: 'Suspenso por segurança',
  on_leave: 'De baixa ou licença',
  ss_admission_missing: 'Falta a admissão na Segurança Social',
  corrective_training_pending: 'Formação corretiva por fazer',
  not_assigned_to_project: 'Não está atribuído a esta obra',
  insufficient_rest: 'Descanso insuficiente desde a última saída',
  daily_limit_reached: 'Limite de horas do dia atingido',
  weekly_limit_reached: 'Limite de horas da semana atingido',
  handover_not_acknowledged: 'Falta confirmar a passagem de turno',
};
const REASON_PREFIX = {
  'document_invalid:': 'Documento em falta ou caducado: ',
  'company_document_invalid:': 'Documento da empresa em falta: ',
  'requirement_missing:': 'Requisito da obra em falta: ',
  'skill_missing:': 'Falta a competência: ',
};
const ERRORS = [
  [/not enough stock of (.+?) \(there are ([\d.]+)\)/i, 'Não há stock suficiente de $1 (há $2).'],
  [/the card is not this person/i, 'Este cartão não é desta pessoa. Quem recebe é quem assina, com o próprio cartão.'],
  [/needs a reason: .*early/i, 'Ainda não chegou a data de troca. Escreve porquê (ex.: rasgado, perdido) e assina outra vez.'],
  [/needs a reason/i, 'Já levou tudo a que tem direito este ano. Escreve porquê e assina outra vez.'],
  [/tool (\S+) calibration expired on (\S+)/i, 'A ferramenta $1 tem a inspeção vencida desde $2. Não pode sair.'],
  [/tool (\S+) is not available/i, 'A ferramenta $1 não está disponível (emprestada, em reparação ou abatida).'],
  [/the tool is lent: get it back first/i, 'Esta ferramenta está emprestada. Recebe-a de volta primeiro.'],
  [/this tool is not lent to anyone/i, 'Esta ferramenta não está emprestada a ninguém.'],
  [/this tag is already used/i, 'Já existe uma ferramenta com este número.'],
  [/this item already exists/i, 'Este artigo já existe. Edita-o em vez de criar outro.'],
  [/a failed inspection is cleared only by a new inspection/i, 'Chumbou na inspeção: só volta a sair com uma inspeção nova aprovada.'],
  [/say what happened \(5 letters/i, 'Escreve o que aconteceu (5 letras ou mais).'],
  [/say why the tool is retired/i, 'Escreve porque é que a ferramenta é abatida.'],
  [/choose what to deliver/i, 'Escolhe o que a pessoa leva.'],
  [/choose what kind of item/i, 'Escolhe o tipo: EPI, farda ou consumível.'],
  [/gloves size/i, 'Tamanho de luvas: de 6 a 12.'],
  [/trousers size/i, 'Tamanho de calça: de XS a XXL.'],
  [/name the warehouse/i, 'Dá um nome ao armazém.'],
  [/name the item/i, 'Dá um nome ao artigo.'],
  [/name the tool/i, 'Dá um nome à ferramenta.'],
  [/give the tool a number/i, 'Dá um número à ferramenta (o que está na etiqueta).'],
  [/write the report number/i, 'Escreve o número do relatório ou certificado.'],
  [/too many lines/i, 'Demasiadas linhas numa entrega (máximo 40).'],
  [/yearly allowance/i, 'Dotação por ano: de 1 a 50.'],
  [/life between 1 day/i, 'Duração: de 1 dia a 10 anos.'],
  [/warehouse not found/i, 'Armazém não encontrado.'],
  [/tool not found/i, 'Ferramenta não encontrada.'],
  [/item not found/i, 'Artigo não encontrado.'],
  [/no worker card/i, 'O LMRA é feito por alguém da equipa no local. Este login não tem ficha de trabalhador.'],
  [/LMRA failed \(stop work\)/i, 'Este LMRA falhou: o trabalho está parado. Resolve o risco e faz um novo.'],
  [/LMRA is from another shift/i, 'Este LMRA é de outro turno. Faz um novo.'],
  [/this card is not known/i, 'Cartão desconhecido. Regista o cartão na ficha da pessoa.'],
  [/say where the work is/i, 'Diz onde é o trabalho.'],
  [/say why the work can go on/i, 'Escreve o que foi resolvido (pelo menos 10 letras).'],
  [/open stop work not found/i, 'Esta paragem já foi levantada.'],
  [/active emergency not found/i, 'Esta emergência já foi terminada.'],
  [/emergency not found/i, 'Emergência não encontrada.'],
  [/assembly point not found/i, 'Ponto de encontro não encontrado.'],
  [/this person is not on the list/i, 'Esta pessoa não estava na lista de quem estava dentro.'],
  [/say how you know the person is safe/i, 'Escreve como sabes que a pessoa está salva.'],
  [/name the assembly point/i, 'Dá um nome ao ponto de encontro.'],
  [/write how the emergency ended/i, 'Escreve como acabou.'],
  [/kind of emergency not known/i, 'Escolhe o tipo de emergência.'],
  [/disagreement\(s\) of workers still to answer/i, 'Há reclamações de trabalhadores por responder neste mês. Responde primeiro (Secretaria › Pedidos e reclamações).'],
  [/finish the previous ones first/i, 'Acaba primeiro as partes anteriores.'],
  [/see it to the end first \((\d+) s left\)/i, 'Ainda não chegaste ao fim. Faltam $1 s.'],
  [/see it to the end first/i, 'Vê até ao fim primeiro.'],
  [/answer every question/i, 'Responde a todas as perguntas.'],
  [/each question needs/i, 'Cada pergunta precisa de texto, 2 a 4 respostas e a certa marcada.'],
  [/paste a YouTube link/i, 'Cola um link de um vídeo do YouTube.'],
  [/this card is not known/i, 'Este cartão não está registado na empresa.'],
  [/this person is not in your team/i, 'Este colaborador não está na tua equipa.'],
  [/tap the card/i, 'Encosta o cartão ou escreve o número.'],
  [/you already disagreed with this day/i, 'Já reclamaste deste dia. Espera pela resposta.'],
  [/there is no day to disagree/i, 'Não há horas nesse dia para reclamar.'],
  [/write what is wrong/i, 'Em «Outro motivo», escreve o que está errado (pelo menos 10 letras).'],
  [/write the answer/i, 'Escreve a resposta (pelo menos 10 letras).'],
  [/write why you refuse/i, 'Escreve porque recusas (pelo menos 10 letras).'],
  [/write why \(at least 5/i, 'Escreve o motivo (pelo menos 5 letras).'],
  [/not enough holiday days left/i, 'Não tens dias de férias suficientes para esse pedido.'],
  [/overlap|conflicting key value violates exclusion constraint/i, 'Já tens um pedido nesses dias.'],
  [/too far in the past: talk to the office/i, 'Esse dia já passou há mais de uma semana: fala com o escritório.'],
  [/some hours only on one day/i, 'Horas só se pedem para um dia.'],
  [/this request was already answered/i, 'Este pedido já foi respondido.'],
  [/only a request still waiting can be cancelled/i, 'Só se cancela um pedido que ainda está à espera.'],
  [/you cannot (decide|answer) your own/i, 'Não podes decidir um pedido teu: é outra pessoa que decide.'],
  [/this month is already closed/i, 'Este mês já está fechado.'],
  [/end date is before the start/i, 'A data de fim é antes do início.'],
  [/team leader must be on the site team/i, 'O responsável de equipa tem de estar atribuído a esta obra.'],
  [/site manager not found/i, 'Escolhe o gestor de obra da lista.'],
  [/client phone: digits only/i, 'O telefone do cliente só leva números (9 a 20), pode começar por +.'],
  [/client email is not valid/i, 'O email do cliente não parece válido.'],
  [/^phone: digits only/i, 'O telefone só leva números (9 a 20), pode começar por +.'],
  [/emergency phone: digits only/i, 'O telefone de emergência só leva números (9 a 20), pode começar por +.'],
  [/email is not valid/i, 'O email não parece válido.'],
  [/shirt size/i, 'Tamanho de camisola: de XS a XXXL.'],
  [/trousers size/i, 'Tamanho de calça: de XS a XXL.'],
  [/boots size/i, 'Número de botas: de 34 a 50.'],
  [/must be 16 to 90 years old/i, 'Data de nascimento: a pessoa tem de ter entre 16 e 90 anos.'],
  [/nationality: country code/i, 'Escolhe a nacionalidade da lista.'],
  [/dependents: 0 to 20/i, 'Dependentes: de 0 a 20.'],
  [/profession up to 80 letters/i, 'Profissão até 80 letras, categoria até 40.'],
  [/a field is too long/i, 'Um dos campos é comprido demais.'],
  [/cannot record your own clock-in late/i, 'Não podes registar a tua própria picagem com atraso (ficou sem rede). Pede a outro encarregado ou ao escritório para a acrescentar como picagem esquecida.'],
  [/tap not found/i, 'Essa picagem já não existe ou já foi anulada.'],
  [/close a whole month/i, 'Só se fecha o mês inteiro, do dia 1 ao último dia.'],
  [/this month is already closed/i, 'Este mês já está fechado.'],
  [/close the whole month instead/i, 'Fecha o mês inteiro no Secretariado.'],
  [/cannot send back your own hours/i, 'Não podes devolver as tuas próprias horas.'],
  [/set the municipality of the site first/i, 'Escreve primeiro o concelho da obra e guarda.'],
  [/date and name are required/i, 'Escreve a data e o nome do feriado.'],
  [/week must start on a Monday/i, 'A semana das diárias começa à segunda-feira.'],
  [/this week has not started yet/i, 'Esta semana ainda não começou: emite as diárias a partir de segunda.'],
  [/choose who to pay/i, 'Escolhe pelo menos uma pessoa.'],
  [/for this week was already issued/i, 'A diária desta pessoa nesta semana já foi emitida.'],
  [/has no diária amount/i, 'Uma obra não tem valor de diária. Põe-no em Obras ou nos valores da empresa.'],
  [/cannot decide your own diária/i, 'Não podes decidir a tua própria diária.'],
  [/write why it is justified/i, 'Escreve porque é que está justificada.'],
  [/this deduction was already made/i, 'Este desconto já foi feito.'],
  [/hours of this day are complete now/i, 'As horas deste dia já estão completas: não há nada a decidir.'],
  [/minimum hours must be between/i, 'O mínimo de horas tem de ser entre 0 e 12.'],
  [/diária must be between/i, 'A diária tem de ser entre 0 e 1000 €.'],
  [/rule text is too long/i, 'A regra é comprida demais (máximo 2000 letras).'],
  [/an issued diária cannot change|issued diária is never deleted/i, 'Uma diária emitida já não muda.'],
  [/country must be PT, ES or FR/i, 'Escolhe Portugal, Espanha ou França.'],
  [/this profile is not yours/i, 'Esse perfil não é teu. Pede ao administrador.'],
  [/admin is given only/i, 'O perfil de administrador só se dá com aprovação de uma segunda pessoa.'],
  [/an admin keeps the admin profile/i, 'Um administrador mantém sempre o perfil de administrador.'],
  [/in your own company you change profile/i, 'Na tua empresa já mudas de perfil com a tua própria pessoa.'],
  [/has not let you in/i, 'Esta empresa não te deixa entrar. Pede acesso de suporte.'],
  [/department name needs/i, 'O nome do departamento tem de ter entre 2 e 60 letras.'],
  [/choose the type of access/i, 'Escolhe o tipo de acesso: escritório, segurança, encarregado ou colaborador.'],
  [/takes no permissions/i, 'O tipo colaborador só vê as próprias horas: não leva permissões.'],
  [/department with this name already exists/i, 'Já existe um departamento com este nome.'],
  [/administration department cannot be changed/i, 'A Administração tem tudo e não se altera.'],
  [/keeps its type of access/i, 'Um departamento base mantém o tipo de acesso.'],
  [/base department is not archived/i, 'Os departamentos base não se arquivam.'],
  [/choose at least one department/i, 'Escolhe pelo menos um departamento.'],
  [/department not found/i, 'Departamento não encontrado (pode ter sido arquivado).'],
  [/unknown permission/i, 'Permissão desconhecida.'],
  [/link this login to a person first/i, 'Esta conta não está ligada a uma pessoa: não pode ser encarregado nem colaborador.'],
  [/choose at least one profile/i, 'Escolhe pelo menos um perfil.'],
  [/only administrator: another admin/i, 'Esta pessoa é o único administrador. Cria outro administrador primeiro.'],
  [/municipality name is too long/i, 'O nome do concelho é comprido demais.'],
  [/only an entry or an exit/i, 'Só se pode acrescentar uma entrada ou uma saída.'],
  [/project not found/i, 'Obra não encontrada, ou já não estás atribuído a ela.'],
  [/collaborator not found/i, 'Escolhe o trabalhador.'],
  [/attach the photo or PDF/i, 'Falta a foto ou o PDF do documento.'],
  [/file not allowed for this person|row-level security/i, 'Sem permissão para guardar este ficheiro. Confirma que entraste com a segunda verificação.'],
  [/file not found, send it again/i, 'O ficheiro não chegou ao servidor. Tenta outra vez.'],
  [/already used by another document/i, 'Esse ficheiro já está noutro documento.'],
  [/invalid file fingerprint/i, 'Não consegui ler o ficheiro. Tenta outra vez.'],
  [/mime type|invalid_mime_type/i, 'Só aceito fotos (JPG, PNG) ou PDF.'],
  [/maximum allowed size|payload too large|entity too large/i, 'O ficheiro é grande demais (máximo 10 MB).'],
  [/(\d+) day\(s\) still to approve/i, 'Ainda há dias por aprovar neste mês. Aprova ou devolve todos antes de fechar.'],
  [/period is not over yet/i, 'O mês ainda não acabou.'],
  [/nothing to close/i, 'Não há nada para fechar neste mês.'],
  [/cannot be sent back/i, 'Esse dia já está fechado para os salários.'],
  [/already sent to payroll|period is locked/i, 'Esse mês já foi fechado para os salários: já não se pode mudar.'],
  [/segregation of duties/i, 'Validaste este dia na obra: tem de ser outra pessoa a aprovar.'],
  [/only HR validates/i, 'Só o secretariado aprova.'],
  [/too far in the past/i, 'A hora da picagem é antiga demais. Acrescenta-a como picagem esquecida, com o motivo.'],
  [/more than 7 days old/i, 'Picagem guardada há mais de 7 dias: acrescenta-a como picagem esquecida, com o motivo.'],
  [/each type needs its own code/i, 'Dois tipos de hora têm o mesmo código do Primavera. Cada tipo precisa do seu código.'],
  [/invalid Primavera code/i, 'Um código do Primavera só pode ter letras, números, ponto, traço ou _ (até 10).'],
  [/invalid time padding/i, 'Escolhe zeros ou espaços para encher o tempo.'],
  [/this field is required/i, 'O funcionário, a data, o código e o tempo têm de ter tamanho maior que 0.'],
  [/two fields overlap/i, 'Dois campos ocupam as mesmas colunas do ficheiro. Acerta as posições.'],
  [/invalid position for/i, 'Uma posição não é válida.'],
  [/invalid marker/i, 'A letra tem de ser uma só letra ou número.'],
  [/simple mode is off/i, 'O modo simples não está ligado nesta empresa.'],
  [/this estimate is frozen/i, 'Este orçamento já foi enviado e está congelado. Para mudar, faz uma nova versão.'],
  [/whoever made the estimate does not sign/i, 'Quem fez o orçamento não o pode assinar: tem de ser outra pessoa.'],
  [/not among the people who sign/i, 'Não estás entre as pessoas que assinam este orçamento (vê «Quem assina»).'],
  [/say why it is refused/i, 'Escreve porque recusas (umas palavras).'],
  [/turnkey price needs an estimate of class 2/i, 'Chave na mão pede um orçamento de classe 2 ou melhor. Muda a qualidade do orçamento ou a forma de preço.'],
  [/estimate needs at least one line/i, 'O orçamento precisa de pelo menos uma linha.'],
  [/price form is switched off/i, 'Essa forma de preço está desligada nesta empresa (vê «Quem assina»).'],
  [/not waiting for signatures/i, 'Este orçamento já não está à espera de assinaturas.'],
  [/already submitted/i, 'Este orçamento já foi enviado.'],
  [/one rule must cover any value/i, 'Falta uma regra «qualquer valor», para nenhum orçamento ficar sem quem assine.'],
  [/right to sign estimates/i, 'Essa pessoa não tem o direito de assinar orçamentos (Departamentos e acessos › «Aprovar o preço»).'],
  [/delegation lasts at most 90 days/i, 'Uma delegação dura no máximo 90 dias.'],
  [/estimate_signatures_estimate_id_user_id_key|duplicate key.*estimate_signatures/i, 'Já assinaste este orçamento.'],
  [/client and title are required/i, 'Escreve o cliente e o que se orçamenta.'],
  [/need <= cardinality|estimate_approval_rules_check/i, 'Uma regra pede mais assinaturas do que pessoas escolhidas.'],
  [/not allowed|insufficient_privilege|permission denied/i, 'Sem permissão. Confirma que entraste com a segunda verificação (código da app).'],
  [/already exists/i, 'Já existe uma obra com esse código.'],
  [/duplicate key.*tax_number|tenant_id, tax_number/i, 'Já existe um trabalhador com esse NIF.'],
  [/duplicate key.*employee_number/i, 'Já existe um trabalhador com esse número.'],
  [/uq_credentials_active_uid|duplicate key.*uid/i, 'Esse cartão já pertence a outra pessoa.'],
  [/write why \(at least (\d+)/i, 'Escreve o motivo (pelo menos umas palavras).'],
  [/at least 10 characters/i, 'Escreve o que foi verificado em papel (pelo menos 10 letras).'],
  [/already belongs to another person/i, 'Esse cartão já pertence a outra pessoa.'],
  [/issue date cannot be in the future/i, 'A data de emissão não pode ser no futuro.'],
  [/expiry date is before the issue date/i, 'A validade não pode ser antes da data de emissão.'],
  [/event time is in the future/i, 'A hora não pode ser no futuro.'],
  [/too old for the Mini/i, 'Essa picagem tem mais de 35 dias. Fala com os Recursos Humanos.'],
  [/cannot add clock-ins for yourself/i, 'Não podes acrescentar picagens a ti próprio.'],
  [/cannot validate your own hours/i, 'Não podes validar as tuas próprias horas.'],
  [/has anomalies/i, 'Esse dia tem picagens em falta. Corrige primeiro.'],
  [/overtime: approve or refuse/i, 'Esse dia tem horas extra: aprova ou recusa.'],
  [/rest day or holiday: approve or refuse/i, 'Esse dia tem horas em dia de descanso ou feriado: aprova ou não aprova.'],
  [/rest days must be week days/i, 'Escolhe dias da semana válidos.'],
  [/at least one working day/i, 'A obra precisa de pelo menos um dia de trabalho.'],
  [/cannot go to/i, 'Esse dia já foi validado.'],
  [/up to 2 months/i, 'Escolhe um período até 2 meses.'],
  [/e-mail already has a login/i, 'Esse email já tem conta.'],
  [/person already has a login/i, 'Esta pessoa já tem conta.'],
  [/invalid e-mail/i, 'O email não parece válido.'],
  [/this person is inactive/i, 'Esta pessoa está inativa.'],
  [/your own login/i, 'Não podes desligar a tua própria conta.'],
  [/could not create the login/i, 'Não consegui criar a conta. Tenta outra vez.'],
  [/required/i, 'Falta preencher um campo obrigatório.'],
  [/Invalid login credentials/i, 'Email ou palavra-passe errados.'],
  [/Failed to fetch|NetworkError|network/i, 'Sem rede. Tenta outra vez.'],
];

// dirOverride: null = automatic (the server decides from the person's state); 'in' / 'out' = forced for the next tap only.
// tapSeq: each tap gets a number; a slow answer for an older tap never overwrites the newer result (A5).
const state = { ready: false, me: null, sites: [], people: [], docTypes: [], view: 'picar', dirOverride: null, nfc: null, timer: null,
  worker: null, weekStart: null, tapSeq: 0, tapLog: [], offline: false, clockOffset: 0, prefill: null };

// ------------------------------------------------------------------ helpers
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel) => app.querySelector(sel);

// ------------------------------------------------------------------ look: icons, chips, avatars, loading, empty states
const ic = (name, extra) => `<svg class="i${extra ? ' ' + extra : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const chip = (kind, text, icon) => `<span class="chip ${kind}">${icon ? ic(icon) : ''}${esc(text)}</span>`;
function initials(name) {
  const w = String(name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : (w[0] || '')[1] || '')).toUpperCase();
}
function avatar(name) {
  let h = 0; for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `<span class="av a${h % 8}" aria-hidden="true">${esc(initials(name))}</span>`;
}
// Skeleton cards instead of "A carregar…".
const skel = (n = 3) => `<div class="skel" aria-busy="true" aria-label="A carregar">${Array.from({ length: n }, (_, i) =>
  `<div class="card"><span class="av"></span><div class="grow"><div class="sk" style="width:${62 - i * 9}%"></div><div class="sk" style="width:${38 + i * 6}%;margin-top:10px"></div></div></div>`).join('')}</div>`;
const ART = {
  helmet: '<path d="M30 58a30 30 0 0 1 60 0v6H30z" fill="var(--brand)"/><rect x="22" y="62" width="76" height="9" rx="4.5" fill="var(--brand)"/><path d="M54 28h12v20H54z" fill="var(--accent)"/><ellipse cx="60" cy="78" rx="34" ry="4" fill="var(--line)"/>',
  calendar: '<rect x="18" y="18" width="84" height="58" rx="8" fill="var(--surface-2)" stroke="var(--line)" stroke-width="2"/><path d="M18 32h84" stroke="var(--line)" stroke-width="2"/><rect x="34" y="10" width="6" height="16" rx="3" fill="var(--brand)"/><rect x="80" y="10" width="6" height="16" rx="3" fill="var(--brand)"/><circle cx="60" cy="54" r="13" fill="var(--accent)"/><path d="M60 47v7l5 3" stroke="#0f1d1c" stroke-width="3" fill="none" stroke-linecap="round"/>',
  box: '<path d="M22 34l38-16 38 16v34l-38 14-38-14z" fill="var(--surface-2)" stroke="var(--line)" stroke-width="2"/><path d="M22 34l38 14 38-14M60 48v34" stroke="var(--line)" stroke-width="2" fill="none"/><path d="M41 26l38 16" stroke="var(--accent)" stroke-width="5"/>',
  card: '<rect x="20" y="20" width="80" height="50" rx="8" fill="var(--surface-2)" stroke="var(--line)" stroke-width="2"/><rect x="30" y="50" width="28" height="6" rx="3" fill="var(--brand)"/><path d="M76 34a10 10 0 0 1 14 0M80 39a4 4 0 0 1 6 0" stroke="var(--accent)" stroke-width="3" fill="none" stroke-linecap="round"/>',
  check: '<circle cx="60" cy="44" r="30" fill="var(--ok-bg)"/><path d="M46 45l10 10 18-20" stroke="var(--ok)" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
};
const empty = (art, title, text) => `<div class="empty"><svg viewBox="0 0 120 84" aria-hidden="true">${ART[art] || ART.box}</svg><b>${esc(title)}</b>${text ? `<p>${esc(text)}</p>` : ''}</div>`;
// One line of help, the rest behind an "i".
const more = (label, html) => `<details class="more"><summary>${esc(label)}</summary><div>${html}</div></details>`;
// Day bar: periods "08:00–12:00 · 13:00–?" over 06:00–20:00 (wider if needed). Open period: to now (today) or dashed (missing).
function dayline(periods, opts = {}) {
  const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
  const segs = periodList(periods).map((p) => { const [a, b] = p.split('–'); return { a: toMin(a), b: toMin(b) }; }).filter((s) => s.a !== null || s.b !== null);
  if (!segs.length) return '';
  let lo = 6 * 60; let hi = 20 * 60;
  for (const s of segs) {
    if (s.a !== null) { lo = Math.min(lo, s.a); hi = Math.max(hi, s.a + 60); }
    if (s.b !== null && (s.a === null || s.b >= s.a)) { hi = Math.max(hi, s.b); lo = Math.min(lo, s.b - 60); }
  }
  if (opts.now !== undefined && segs.some((s) => s.b === null)) hi = Math.max(hi, opts.now + 30);
  lo = Math.max(0, lo);
  if (segs.some((s) => s.a !== null && s.b !== null && s.b < s.a)) hi = 24 * 60;
  lo = Math.floor(lo / 60) * 60; hi = Math.min(24 * 60, Math.ceil(hi / 60) * 60);
  const pc = (m) => Math.max(0, Math.min(100, ((m - lo) / (hi - lo)) * 100)).toFixed(1);
  const now = opts.now;   // minutes since midnight, only for today
  const bars = segs.map((s) => {
    const a = s.a === null ? lo : s.a; let b = s.b; let cls = '';
    if (b === null) { if (now !== undefined && now > a) { b = now; cls = 'open'; } else { b = Math.min(hi, a + 120); cls = 'miss'; } }
    if (b < a) b = 24 * 60;
    if (s.a === null) cls = 'miss';
    return `<i class="${cls}" style="left:${pc(a)}%;width:${(pc(b) - pc(a)).toFixed(1)}%"></i>`;
  }).join('');
  const hh = (m) => pad2(Math.floor(m / 60) % 24) + 'h';
  return `<div class="dayline" role="img" aria-label="${esc(periods)}">${bars}${now !== undefined && now >= lo && now <= hi ? `<u style="left:${pc(now)}%"></u>` : ''}</div>${opts.axis ? `
    <div class="axis" aria-hidden="true"><span>${hh(lo)}</span><span>${hh((lo + hi) / 2 - ((lo + hi) / 2) % 60)}</span><span>${hh(hi)}</span></div>` : ''}`;
}
const periodsHtml = (list) => list.map((p) => `<span>${esc(p)}</span>`).join(' · ');

// ---- Modo Sol (alto contraste): botão no topo, guardado neste telemóvel; também quando o sistema pede mais contraste.
const THEME_KEY = 'gestnow.theme';
function applyTheme() {
  let t = null; try { t = localStorage.getItem(THEME_KEY); } catch (_) {}
  const sol = t === 'sol' || (t === null && window.matchMedia && matchMedia('(prefers-contrast: more)').matches);
  if (sol) document.documentElement.dataset.theme = 'sol'; else delete document.documentElement.dataset.theme;
  const b = document.getElementById('sol'); if (b) b.setAttribute('aria-pressed', String(sol));
}
applyTheme();
document.getElementById('sol').addEventListener('click', () => {
  const on = document.documentElement.dataset.theme !== 'sol';
  try { localStorage.setItem(THEME_KEY, on ? 'sol' : 'normal'); } catch (_) {}
  applyTheme(); toast(on ? 'Modo sol: mais contraste.' : 'Modo normal.');
});

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3500);
}
function friendly(err) {
  const msg = (err && (err.message || err.error_description || err.hint)) || String(err);
  if (AUTH_LOST.test(msg)) checkSession();
  // A missed entry for a person who was blocked at that time (inactive, documents): say why, in plain words.
  const nosign = /access denied for LMRA signature:\s*(.*)$/i.exec(msg);
  if (nosign) return `Esta pessoa não pode assinar nem trabalhar: ${nosign[1].split(/,\s*/).map(reasonText).join(' · ')}.`;
  const blocked = /could not enter at that time:\s*(.*)$/i.exec(msg);
  if (blocked) return `Esta pessoa não podia entrar a essa hora: ${blocked[1].split(/,\s*/).map(reasonText).join(' · ')}. Resolve isso primeiro ou fala com o escritório.`;
  for (const [re, pt] of ERRORS) if (re.test(msg)) return pt.replace(/\$(\d)/g, (_, n) => (re.exec(msg) || [])[+n] || '');
  return 'Erro: ' + msg;
}
function reasonText(code) {
  if (REASONS[code]) return REASONS[code];
  if (code.startsWith('document_invalid:')) {
    const t = state.docTypes.find((d) => d.code === code.slice(17));
    if (t) return t.name + ' em falta ou caducado(a)';
  }
  for (const p in REASON_PREFIX) if (code.startsWith(p)) return REASON_PREFIX[p] + code.slice(p.length);
  return code;
}
// ---- Time zones: every time on screen and every time typed in is the SITE's time (BTA-01 is in Madrid), never the phone's.
const DEFAULT_TZ = 'Europe/Lisbon';
const siteTz = (id) => ((state.sites.find((s) => s.id === id) || {}).timezone) || DEFAULT_TZ;
const TZ_NAMES = { 'Europe/Lisbon': 'hora de Portugal continental', 'Europe/Madrid': 'hora de Espanha (Madrid)', 'Europe/Paris': 'hora de França (Paris)',
  'Atlantic/Azores': 'hora dos Açores', 'Atlantic/Madeira': 'hora da Madeira', 'Atlantic/Canary': 'hora das Canárias' };
const tzName = (tz) => TZ_NAMES[tz] || 'hora de ' + tz;
const tzFmt = {};
function tzParts(ms, tz) {
  const f = tzFmt[tz] || (tzFmt[tz] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return p;
}
const tzOffset = (ms, tz) => { const p = tzParts(ms, tz); return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(ms / 1000) * 1000; };
// "2026-10-16T08:00" typed as the site's time -> the real moment (ISO, UTC). In the October hour that repeats, the first one.
function zonedToUtc(local, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local || ''); if (!m) return null;
  const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const o1 = tzOffset(base - 12 * 3600000, tz); const o2 = tzOffset(base + 12 * 3600000, tz);
  const cands = [base - o1, base - o2].filter((t) => tzOffset(t, tz) === base - t).sort((a, b) => a - b);
  return new Date(cands.length ? cands[0] : base - o1).toISOString();   // a time skipped by the spring change moves forward
}
const pad2 = (n) => String(n).padStart(2, '0');
// The site's date ("2026-10-16") and "date + time" for a datetime-local field, of a real moment.
const localDay = (iso, tz) => { const p = tzParts(new Date(iso).getTime(), tz || DEFAULT_TZ); return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`; };
const localInput = (iso, tz) => { const p = tzParts(new Date(iso).getTime(), tz || DEFAULT_TZ); return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour % 24)}:${pad2(p.minute)}`; };
const fmtTime = (iso, tz) => new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: tz || DEFAULT_TZ });
const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const fmtHour = (iso, tz) => iso ? new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: tz || DEFAULT_TZ }) : '';
// Every problem the hours engine can flag, in plain words. A shift still open today is not an error yet.
const ANOMALY = { double_in: 'duas entradas seguidas', out_without_in: 'saída sem entrada', missing_out: 'falta a saída',
  open_shift: 'ainda sem saída' };
const anomalyText = (code, day, tz) => (code === 'open_shift' && day < localDay(new Date().toISOString(), tz) ? 'falta a saída'
  : ANOMALY[code] || 'picagens a verificar');
const onlyOpenToday = (r, tz) => r.anomalies.length > 0 && r.anomalies.every((a) => a === 'open_shift') && r.shift_date >= localDay(new Date().toISOString(), tz);
// Every in/out period of a day, as the server wrote it in the site's time zone ("08:00–12:00 · 13:00–17:00").
const periodList = (p) => (p ? p.split(' · ') : []);
async function dayPeriods(from, to, project) {
  const { data } = await sb.rpc('mini_day_periods', project ? { p_from: from, p_to: to, p_project: project } : { p_from: from, p_to: to });
  return Object.fromEntries((data || []).map((r) => [r.work_day_id, r.periods]));
}
const fmtMin = (m) => { m = m || 0; return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; };
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// What this login may do in its current profile, from its departments (mini_my_access). The database checks the
// same permission in every function; the app only hides what would be refused.
const can = (perm) => !!(state.me && (state.me.role === 'admin' || (state.me.perms || []).includes(perm)));
const canOffice = () => can('horas.aprovar') || can('salarios.exportar') || can('diarias.emitir');
const canPeople = () => can('pessoas.gerir');
const canDocs = () => can('documentos.gerir');

// ------------------------------------------------------------------ Comprovativos (foto ou PDF de cada documento)
// Private bucket: only admin, HR and safety send or open files, and a file is never replaced or deleted.
const FILE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const FILE_MAX = 10 * 1024 * 1024;
const FILE_ACCEPT = Object.keys(FILE_TYPES).join(',');
function fileProblem(file) {
  if (!file || !file.size) return 'Falta a foto ou o PDF do documento.';
  if (!FILE_TYPES[file.type]) return 'Só aceito fotos (JPG, PNG) ou PDF.';
  if (file.size > FILE_MAX) return 'O ficheiro é grande demais (máximo 10 MB). Tira a foto com menos qualidade.';
  return null;
}
async function sha256Hex(file) {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// Send the file, then register the document pointing to it. Returns { error } like an rpc.
async function addDocument(collab, type, issue, expiry, number, file) {
  const bad = fileProblem(file); if (bad) return { error: { message: bad } };
  const path = `${state.me.tenant_id}/${collab}/${crypto.randomUUID()}.${FILE_TYPES[file.type]}`;
  const sha = await sha256Hex(file);
  const up = await sb.storage.from('documentos').upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) return { error: up.error };
  return sb.rpc('mini_add_document', { p_collab: collab, p_type: type, p_issue: issue, p_expiry: expiry || null,
    p_number: number || null, p_file: path, p_sha256: sha });
}
// Open a file with a link that only works for 2 minutes.
async function openDocFile(path) {
  const win = window.open('', '_blank');
  if (win) win.opener = null;
  const { data, error } = await sb.storage.from('documentos').createSignedUrl(path, 120);
  if (error || !data) { if (win) win.close(); return toast(friendly(error || 'sem link')); }
  if (win) win.location = data.signedUrl; else location.href = data.signedUrl;
}
const normUid = (v) => String(v || '').replace(/[\s:\-]/g, '').toUpperCase();
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
// Returns false when the phone would not save (storage full or blocked): the caller must say so (B4).
function store(key, val) {
  try { val === undefined ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(val)); return true; } catch (_) { return false; }
}
function load(key, dflt) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : dflt; } catch (_) { return dflt; } }
// true: short high beep (accepted). false: long low buzz (refused or error). 'neutral': two medium beeps (saved, not checked yet).
function beep(ok) {
  const neutral = ok === 'neutral';
  // Short tick = accepted; long triple buzz = refused; two soft taps = saved, not checked yet. No vibration API (iPhone): sound and colour only.
  try { if (typeof navigator.vibrate === 'function') navigator.vibrate(neutral ? [40, 80, 40] : ok ? [40] : [80, 60, 80, 60, 160]); } catch (_) {}
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)(); const g = a.createGain(); g.connect(a.destination); g.gain.value = 0.15;
    const tone = (f, at, len) => { const o = a.createOscillator(); o.frequency.value = f; o.connect(g); o.start(a.currentTime + at); o.stop(a.currentTime + at + len); };
    if (neutral) { tone(520, 0, 0.1); tone(520, 0.2, 0.1); } else tone(ok ? 880 : 220, 0, ok ? 0.15 : 0.5);
  } catch (_) {}
}
// A short, stable fingerprint of a card number, so the last direction can be remembered without keeping the number.
function cardKey(uid) { let h = 0x811c9dc5; for (const ch of String(uid)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); }

// ------------------------------------------------------------------ start
if (!cfg.url || cfg.url.startsWith('COLA_') || !window.supabase) {
  app.innerHTML = `<div class="card"><h1>Falta configurar</h1>
    <p>Abre o ficheiro <code>config.js</code> e cola o <b>Project URL</b> e a chave <b>anon public</b> do Supabase
    (Project Settings &gt; API).</p></div>`;
  throw new Error('config missing');
}
const sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
const core = () => sb.schema('core');

nav.addEventListener('click', (e) => {
  if (e.target.id === 'scrim') return openMore(false);
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.more !== undefined) return openMore(document.getElementById('more').hidden);
  openMore(false);
  if (b.dataset.action === 'sair') return signOut();
  if (b.dataset.action === 'tour') return startTour();
  if (b.dataset.view === 'orcamentos' && state.orc) { state.orc.id = null; state.orc.mode = 'list'; }   // the menu always opens the list
  go(b.dataset.view);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openMore(false); });
// Bottom tab bar: four tabs for what this role uses most, the rest under "Mais" (with "Sair").
// The buttons are the same elements (same data-view), only moved; who may open a screen is still decided in go() and each view.
const APP_VERSION = '37';
const TABS = { supervisor: ['equipa', 'picar', 'horas', 'naobra'], admin: ['picar', 'painel', 'horas', 'secretariado'],
  hr: ['secretariado', 'horas', 'naobra', 'trabalhadores'], hse: ['emergencia', 'lmra', 'seguranca', 'naobra'],
  project_manager: ['picar', 'painel', 'horas', 'obras'], finance: ['picar', 'naobra', 'horas', 'obras'], worker: ['minhas'] };
const MORE_ORDER = ['equipa', 'picar', 'emergencia', 'lmra', 'painel', 'naobra', 'horas', 'minhas', 'secretariado', 'seguranca', 'trabalhadores', 'acolhimento', 'obras', 'orcamentos', 'armazem', 'processo', 'clientes'];
// Computer mode: on a wide screen (the office PC) the menu is a column on the left with every screen in it, and the
// Secretariado shows tables. The phone keeps the bottom bar. Same code, same rules: only the layout changes.
const WIDE = window.matchMedia('(min-width: 1100px)');
const isWide = () => WIDE.matches;
WIDE.addEventListener('change', () => {
  if (!state.ready || !state.me) return;
  layoutNav(state.me.role);
  if (state.view === 'secretariado') viewOffice();
});
function layoutNav(role) {
  const tabs = document.getElementById('tabs'); const sheet = document.getElementById('more');
  const btn = (v) => nav.querySelector(`button[data-view="${v}"]`);
  const first = (TABS[role] || TABS.supervisor).filter((v) => !btn(v).hidden);
  const main = isWide() ? [...first, ...MORE_ORDER.filter((v) => !first.includes(v) && !btn(v).hidden)] : first;
  const moreBtn = nav.querySelector('button[data-more]');
  for (const v of main) tabs.insertBefore(btn(v), moreBtn);
  for (const v of MORE_ORDER) if (!main.includes(v) && !btn(v).hidden) sheet.appendChild(btn(v));
  for (const v of MORE_ORDER) if (btn(v).hidden && btn(v).parentElement !== sheet) sheet.appendChild(btn(v));
  sheet.appendChild(nav.querySelector('button[data-action=tour]'));
  sheet.appendChild(Object.assign(document.createElement('hr'), {}));
  sheet.appendChild(nav.querySelector('button[data-action=sair]'));
  sheet.querySelectorAll('hr').forEach((h, i, all) => { if (i < all.length - 1) h.remove(); });
  // Which version this phone is running, so anyone can check that an update arrived.
  if (!sheet.querySelector('.ver')) sheet.appendChild(Object.assign(document.createElement('p'), { className: 'ver', textContent: 'Versão ' + APP_VERSION }));
  if (isWide()) { tabs.insertBefore(nav.querySelector('button[data-action=tour]'), moreBtn); tabs.insertBefore(nav.querySelector('button[data-action=sair]'), moreBtn); }
}
function openMore(open) {
  const sheet = document.getElementById('more'); if (!sheet) return;
  sheet.hidden = !open; document.getElementById('scrim').hidden = !open;
  nav.querySelector('button[data-more]').setAttribute('aria-expanded', String(!!open));
}
// Header: "Sem rede" and taps waiting, always in sight.
function showNet() {
  const el = document.getElementById('net'); if (!el) return;
  const me = state.me && state.me.user_id;
  const n = state.ready ? queue().filter((x) => !x._u || x._u === me).length : 0;
  const off = state.ready && (state.offline || navigator.onLine === false);
  el.hidden = !(off || n);
  el.textContent = off ? `Sem rede${n ? ' · ' + n : ''}` : `${n} por enviar`;
}
sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') boot(); });
// The session can end outside this tab (Sair in another tab, expired token). Re-check when the user comes back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (state.ready && state.me && idleTooLong(state.me.role)) return idleOut();
  checkSession();
});

// Inactivity lock: a phone left open (lost, lent, on a table) must not stay logged in.
// Short for the roles that see personal and health data, a full shift for the site roles.
const ACTIVE_KEY = 'gestnow.lastActive';
const IDLE_MIN = (role) => (['admin', 'hr', 'hse', 'finance', 'project_manager'].includes(role) ? 15 : 12 * 60);
function touch() { try { localStorage.setItem(ACTIVE_KEY, String(Date.now())); } catch (_) {} }
function idleTooLong(role) {
  let t = 0; try { t = Number(localStorage.getItem(ACTIVE_KEY)) || 0; } catch (_) {}
  return Date.now() - t > IDLE_MIN(role) * 60000;
}
async function idleOut() { state.idleOut = true; stopNfc(); state.ready = false; nav.hidden = true; closePalette(); await sb.auth.signOut({ scope: 'local' }); }
let lastTouch = 0;
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => {
  if (state.ready && Date.now() - lastTouch > 15000) { lastTouch = Date.now(); touch(); }
}, { passive: true }));
setInterval(() => { if (state.ready && state.me && idleTooLong(state.me.role)) idleOut(); }, 30000);
// Saved taps are retried every minute too: the "online" event alone is not reliable on Android.
setInterval(() => { if (state.ready && queue().length) flushQueue(); }, 60000);
setInterval(() => { if (state.ready && !state.offline) syncClock(); }, 10 * 60000);
window.addEventListener('online', () => {
  if (!state.ready || state.offline) return boot();   // the network-error screen, or Picar opened without network
  flushQueue(); syncClock(); flushMuster();
});
window.addEventListener('offline', () => { showQueue(); });
// The app shell (these files, never the Supabase data or the login) is kept on the phone, so Picar opens without network.
// Service workers only run on https:// (and on localhost for the tests); opened from a file there is none.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  // A new version is looked for every time the app comes back to the screen, and is used at once.
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  if (navigator.serviceWorker.controller) {
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }
}
const isNetErr = (e, status) => status === 0 || /fetch|network|Load failed|timeout|aborted|ERR_/i.test((e && (e.message || e.name)) || String(e || ''));
function storedSessionExists() { try { return Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)); } catch (_) { return false; } }

state.clockOffset = (load(CLOCK_KEY, null) || {}).off || 0;
boot();

async function boot() {
  stopNfc(); clearInterval(state.timer); clearInterval(state.tick); hideFlash(); openMore(false);
  state.ready = false; state.offline = false; nav.hidden = true; document.getElementById('whoami').hidden = true;
  document.getElementById('sol').hidden = true; document.getElementById('search').hidden = true; document.getElementById('help').hidden = true; closePalette(); signedOut(true); showNet();
  let session = null; let sErr = null;
  try { const r = await sb.auth.getSession(); session = r.data.session; sErr = r.error; } catch (e) { sErr = e; }
  if (!session) return (sErr && isNetErr(sErr)) || (navigator.onLine === false && storedSessionExists()) ? showNetworkError() : showLogin();
  let me = null; let error = null;
  try {
    ({ data: me, error } = await core().from('app_users')
      .select('role, allowed_roles, tenant_id, organization_id, collaborator_id, is_active').eq('user_id', session.user.id).maybeSingle().retry(false));   // no network: say so at once
  } catch (e) { error = e; }
  // No network is not "no access": open Picar with the last known login of THIS user (taps are queued), or say "no network".
  if (error && (isNetErr(error) || navigator.onLine === false)) {
    const cached = load(ME_KEY, null);
    if (!cached || cached.user_id !== session.user.id) return showNetworkError();
    me = cached; state.offline = true;
  } else if (error || !me) {
    return showMessage('Sem acesso', 'Este utilizador ainda não está ligado a nenhuma empresa. Corre o primeiro-admin.sql com este email.', true);
  }
  if (!me.is_active) return showMessage('Conta desligada', 'A tua conta está desligada. Fala com o administrador.', true);
  if (idleTooLong(me.role)) return idleOut();   // nothing is shown before this check
  state.me = { role: me.role, profiles: me.allowed_roles || me.profiles || [me.role], tenant_id: me.tenant_id, organization_id: me.organization_id, collaborator_id: me.collaborator_id,
    is_active: me.is_active, email: session.user.email, user_id: session.user.id, perms: me.perms || [], depts: me.depts || [] };
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (PRIVILEGED.includes(me.role) && (!aal || aal.currentLevel !== 'aal2')) {
    if (state.offline) return showNetworkError();
    return aal && aal.nextLevel === 'aal2' ? showMfaVerify() : showMfaEnroll();
  }
  // A login made by the admin comes with a temporary password: the person chooses their own first.
  if (session.user.user_metadata && session.user.user_metadata.must_change_password) return state.offline ? showNetworkError() : showNewPassword();
  // A person still in onboarding sees only the steps (the database shows nothing else to them anyway).
  document.body.classList.remove('onboarding');
  if (!state.offline && me.collaborator_id) {
    const { data: ob } = await sb.rpc('mini_onboarding');
    if (ob && ob.status && ob.status !== 'active' && ob.status !== 'none') return showOnboarding(ob);
  }
  if (!state.offline) {
    const { data: acc } = await sb.rpc('mini_my_access');
    if (acc) { state.me.perms = acc.permissions || []; state.me.depts = acc.departments || []; state.me.profiles = acc.profiles || state.me.profiles; }
    const { data: pw } = await sb.rpc('platform_whoami');
    state.platform = pw || null;
    store(ME_KEY, { ...state.me });
  }
  state.ready = true; touch();
  nav.querySelector('[data-view=secretariado]').hidden = !canOffice();
  // The worker profile sees only their own hours; anyone with a person behind the login has them under Mais.
  const worker = me.role === 'worker';
  nav.querySelectorAll('button[data-view]').forEach((b) => { if (b.dataset.view !== 'minhas' && b.dataset.view !== 'secretariado') b.hidden = worker; });
  nav.querySelector('[data-view=minhas]').hidden = !me.collaborator_id;
  nav.querySelector('[data-view=painel]').hidden = worker || !canSiteDetails();
  nav.querySelector('[data-view=acolhimento]').hidden = worker || !can('acolhimento.gerir');
  nav.querySelector('[data-view=clientes]').hidden = worker || state.offline || !isOwner();
  nav.querySelector('[data-view=processo]').hidden = worker || state.offline || !canProcess();
  nav.querySelector('[data-view=orcamentos]').hidden = worker || state.offline || !canEstimates();
  nav.querySelector('[data-view=equipa]').hidden = me.role !== 'supervisor' || !canSiteDetails();
  nav.querySelector('[data-view=lmra]').hidden = worker || state.offline || !canLmra();
  nav.querySelector('[data-view=emergencia]').hidden = worker || !canEmergency();
  nav.querySelector('[data-view=armazem]').hidden = worker || state.offline || !canWh();
  if (me.role === 'supervisor' && !state.booted && state.view === 'picar' && canSiteDetails()) state.view = 'equipa';
  state.booted = true;
  if (state.view === 'minhas' && !me.collaborator_id) state.view = (TABS[me.role] || TABS.supervisor)[0];
  layoutNav(me.role);
  signedOut(false); nav.hidden = false; document.getElementById('sol').hidden = false; document.getElementById('search').hidden = me.role === 'worker';
  document.getElementById('help').hidden = nav.querySelector('[data-view=processo]').hidden; showNet();
  await loadBasics();
  showWho();
  if (state.offline) { go('picar'); return; }
  syncClock();
  flushQueue();
  const other = queue().filter((x) => x._u && x._u !== state.me.user_id);
  if (other.length) toast(`Há ${other.length} picagem(ns) de outra conta neste telemóvel, ainda por enviar.`);
  go(state.view);
  if (state.tourNext) { state.tourNext = false; setTimeout(startTour, 700); return; }   // just finished the onboarding: the bot shows the app
  showBrief();
}
// Once a day, on the first screen: what needs this person today, in one line, from the control room's numbers.
// Only for logins that can see the site panels (the same check as the control room's database function).
const BRIEF_KEY = 'gestnow.brief';
async function showBrief() {
  if (state.offline || !state.me || state.me.role === 'worker' || !canSiteDetails()) return;
  const key = state.me.user_id + ':' + isoDay(new Date());
  if (load(BRIEF_KEY, '') === key || state.view === 'painel' || state.view === 'equipa') return;
  const { data, error } = await sb.rpc('mini_control_room');
  if (error || !data || !Array.isArray(data.sites) || !state.ready || state.view === 'painel' || $('#brief')) return;
  store(BRIEF_KEY, key);
  const sum = (k) => data.sites.reduce((a, x) => a + (x[k] || 0), 0);
  const parts = [[sum('blocked'), 'pessoa(s) não podem entrar'], [sum('missing_out'), 'saída(s) em falta'], [sum('to_validate'), 'dia(s) por validar na obra'],
    [sum('to_approve'), 'dia(s) por aprovar no escritório'], [sum('expiring'), 'documento(s) a caducar em 30 dias']].filter(([n]) => n > 0);
  const me = state.people.find((x) => x.id === state.me.collaborator_id);
  const h = tzParts(Date.now(), DEFAULT_TZ).hour % 24;
  const hello = (h >= 6 && h < 13 ? 'Bom dia' : h >= 13 && h < 20 ? 'Boa tarde' : 'Boa noite') + (me ? ', ' + me.full_name.split(' ')[0] : '');
  const text = parts.length ? 'Hoje: ' + parts.map(([n, t]) => `<b>${n}</b> ${esc(t)}`).join(' · ') + '.'
    : `Tudo em ordem nas tuas ${data.sites.length} obra(s).`;
  const el = document.createElement('div'); el.id = 'brief'; el.className = 'brief' + (parts.length ? '' : ' ok'); el.setAttribute('role', 'status');
  el.innerHTML = `<span class="brief-ic">${ic(parts.length ? 'warn' : 'ok')}</span><div class="grow"><b>${esc(hello)}.</b> <span>${text}</span></div>
    ${parts.length ? '<button class="btn small" data-go>Ver o dashboard</button>' : ''}<button class="iconbtn" data-x aria-label="Fechar">${ic('x')}</button>`;
  app.prepend(el);
  el.querySelector('[data-x]').onclick = () => el.remove();
  if (el.querySelector('[data-go]')) el.querySelector('[data-go]').onclick = () => go('painel');
}
// No network at all (and nothing to open offline): say it plainly, never "no access", and try again by itself.
function showNetworkError() {
  nav.hidden = true;
  const n = queue().length;
  authScreen(`<h1>Sem ligação</h1>
    <p>Não consegui falar com o servidor. Confirma que o telemóvel tem rede (dados móveis ou Wi-Fi).</p>
    ${n ? `<div class="result warn">${ic('cloud')}<div><b>${n} picagem(ns) guardada(s)</b>Não se perdem: são enviadas quando a rede voltar.</div></div>` : ''}
    <button class="btn big" id="retry">Tentar outra vez</button>`);
  $('#retry').onclick = () => boot();
}
// Before login: brand background, logo, one white card. No menu, no data.
function signedOut(on) { document.body.classList.toggle('signed-out', !!on); }
const LOGO = (id) => `<svg viewBox="0 0 44 44" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#818cf8"/><stop offset="1" stop-color="#4338ca"/></linearGradient></defs><rect width="44" height="44" rx="12" fill="url(#${id})"/><path d="M31.5 15.2A11 11 0 1 0 33 22" fill="none" stroke="#fff" stroke-width="4.6" stroke-linecap="round"/><path d="M22.5 22H27" stroke="#fff" stroke-width="4.6" stroke-linecap="round"/><circle cx="33" cy="22" r="3.3" fill="#fbbf24"/></svg>`;
// Before login: the shop window. Left (computer) or top (phone) sells the app; the card only asks for what is needed.
// Marketing only: no menu, no data, nothing that needs a session.
function authScreen(inner) {
  signedOut(true);
  const online = navigator.onLine !== false;
  const feat = (i, b, t) => `<li><span class="fi">${ic(i)}</span><div><b>${b}</b><small>${t}</small></div></li>`;
  app.innerHTML = `<div class="auth">
    <aside class="auth-hero">
      <div class="logo-big">${LOGO('lgA')}<div><b>GestNow</b><span>Operações de obra industrial</span></div></div>
      <div class="auth-pitch">
        <h2>A obra inteira,<br><em>num toque.</em></h2>
        <p>Picagem por cartão, horas validadas e documentos em dia. Feito para equipas que não podem parar.</p>
        <ul class="feats">
          ${feat('tap', 'Picar num segundo', 'O cartão encosta ao telemóvel. Sem rede, guarda e envia depois.')}
          ${feat('clock', 'Horas sem papel', 'O encarregado valida a semana e o escritório fecha o mês.')}
          ${feat('shield', 'Ninguém entra sem documentos', 'Validades controladas, entrada bloqueada quando algo falta.')}
        </ul>
      </div>
      <div class="demo" aria-hidden="true">
        <div class="phone"><div class="scr"><small>PICAR</small><b>07:58</b><div class="ring"><span></span><span></span>${ic('tap')}</div></div></div>
        <div class="tag-card"><i></i><span>GestNow</span></div>
        <div class="ok-pill">${ic('ok')}<div><b>Entrada registada</b><small>07:58 · Obra Exemplo</small></div></div>
      </div>
    </aside>
    <section class="auth-main">
      <div class="card">${inner}</div>
      <p class="trust">${ic('shield')}<span>Dados alojados na UE</span><span>RGPD</span><span>Verificação em 2 passos</span></p>
      <p class="foot"><i class="${online ? '' : 'off'}"></i>${online ? 'Ligado à rede' : 'Sem rede'}</p>
    </section></div>`;
}

const AUTH_LOST = /permission denied|JWT|not authenticated|401/i;
async function sessionGone() {
  const { data: { session } } = await sb.auth.getSession();
  return !session;
}
// If the screen is open but the login is gone, go back to "Entrar" instead of showing errors.
async function checkSession() {
  if (!state.ready || !(await sessionGone())) return false;
  toast('A sessão terminou. Entra outra vez.');
  boot();
  return true;
}

async function signOut() { stopNfc(); state.ready = false; nav.hidden = true; store(ME_KEY, undefined); await sb.auth.signOut(); }

function showMessage(title, text, withLogout) {
  nav.hidden = true;
  authScreen(`<h1>${esc(title)}</h1><p>${esc(text)}</p>
    ${withLogout ? '<button class="btn ghost wide" id="out">Sair</button>' : ''}`);
  if (withLogout) $('#out').onclick = signOut;
}

// ------------------------------------------------------------------ login and MFA
function showLogin() {
  nav.hidden = true;
  authScreen(`<h1>Entrar</h1>${state.idleOut ? `<div class="result warn">${ic('clock')}<div>Saíste automaticamente por estares sem mexer na app. Entra outra vez.</div></div>`
      : '<p class="muted lead">Entra com o email e a palavra-passe da empresa.</p>'}
    <form id="f"><label for="em">Email</label><input id="em" name="email" type="email" autocomplete="username" inputmode="email" required>
    <label for="pw">Palavra-passe</label><input id="pw" name="password" type="password" autocomplete="current-password" required>
    <p style="margin-top:22px"><button class="btn big go">Entrar ${ic('go')}</button></p></form>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') });
    if (error) return toast(friendly(error));
    state.idleOut = false; touch(); boot();
  };
}

async function showMfaEnroll() {
  nav.hidden = true;
  // Drop half-finished enrolments so a new QR can be issued.
  const { data: list } = await sb.auth.mfa.listFactors();
  for (const f of (list && list.all) || []) if (f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'GestNow ' + new Date().toISOString().slice(0, 10) });
  if (error) return showMessage('Segunda verificação', friendly(error), true);
  authScreen(`<h1>Ativar a segunda verificação</h1>
    <p>Como administrador, precisas de um código do telemóvel para entrar. Faz isto uma vez:</p>
    <ol><li>Instala no telemóvel uma app de códigos (Google Authenticator, Microsoft Authenticator ou 1Password).</li>
    <li>Na app, adiciona uma conta e aponta a câmara para este código:</li></ol>
    <div class="qr"><img alt="Código QR" src="${esc(data.totp.qr_code)}"></div>
    <p class="small muted">Se não conseguires ler o QR, escreve esta chave na app: <code>${esc(data.totp.secret)}</code></p>
    <form id="f"><label>Escreve o código de 6 números que aparece na app</label>
    <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required>
    <div class="acts"><button class="btn big acc">Confirmar</button><button type="button" class="btn ghost" id="out">Sair</button></div></form>`);
  $('#out').onclick = signOut;
  $('#f').onsubmit = (e) => { e.preventDefault(); verifyCode(data.id, new FormData(e.target).get('code')); };
}

async function showMfaVerify() {
  nav.hidden = true;
  const { data: list } = await sb.auth.mfa.listFactors();
  const factor = list && list.totp && list.totp[0];
  if (!factor) return showMfaEnroll();
  authScreen(`<h1>Código de verificação</h1>
    <form id="f"><label>Abre a app de códigos e escreve os 6 números</label>
    <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required autofocus style="font-size:26px;letter-spacing:6px;text-align:center">
    <div class="acts"><button class="btn big acc">Confirmar</button><button type="button" class="btn ghost" id="out">Sair</button></div></form>`);
  $('#out').onclick = signOut;
  $('#f').onsubmit = (e) => { e.preventDefault(); verifyCode(factor.id, new FormData(e.target).get('code')); };
}

function showNewPassword() {
  nav.hidden = true;
  authScreen(`<h1>Escolhe a tua palavra-passe</h1>
    <p>Entraste com uma palavra-passe temporária. Escolhe agora a tua. Não a digas a ninguém.</p>
    <form id="f"><label>Palavra-passe nova (pelo menos 10 caracteres)</label>
    <input name="p1" type="password" autocomplete="new-password" minlength="10" required>
    <label>Repete a palavra-passe</label><input name="p2" type="password" autocomplete="new-password" minlength="10" required>
    <div class="acts"><button class="btn big acc">Guardar</button><button type="button" class="btn ghost" id="out">Sair</button></div></form>`);
  $('#out').onclick = signOut;
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    if (f.get('p1') !== f.get('p2')) return toast('As duas palavras-passe não são iguais.');
    const { error } = await sb.auth.updateUser({ password: f.get('p1'), data: { must_change_password: false } });
    if (error) return toast(/same|different/i.test(error.message) ? 'Escolhe uma palavra-passe diferente da temporária.' : friendly(error));
    toast('Palavra-passe guardada.'); boot();
  };
}

async function verifyCode(factorId, code) {
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: String(code).trim() });
  if (error) return toast('Código errado ou expirado. Tenta o próximo.');
  boot();
}

// ------------------------------------------------------------------ data
// Always show who is logged in and with which role, so nobody mistakes one account for another.
const ROLE_NAMES = { admin: 'Administrador', hr: 'Secretariado / RH', hse: 'Técnico de segurança', finance: 'Finanças',
  project_manager: 'Diretor de obra', supervisor: 'Encarregado', worker: 'Colaborador' };
const PROFILE_HELP = { admin: 'Tudo: obras, pessoas, contas e escritório. Pede o código do telemóvel.', supervisor: 'Picar, quem está na obra e validar as horas da equipa.',
  hr: 'Escritório: horas de todas as obras, documentos e fecho do mês.', hse: 'Segurança: documentos e quem está na obra.', worker: 'Só as tuas horas, como qualquer colaborador.' };
const PROFILE_ORDER = ['admin', 'hr', 'hse', 'supervisor', 'worker'];
// The type of access a department gives (its profile), in the admin's words.
const KIND_NAMES = { admin: 'administração', hr: 'escritório', hse: 'segurança', supervisor: 'encarregado', worker: 'colaborador' };
const KIND_HELP = { hr: 'Trabalha no escritório. Pede sempre o código do telemóvel.', hse: 'Segurança. Pede sempre o código do telemóvel.',
  supervisor: 'Trabalha na obra: só vê as obras onde está. Permissões sensíveis pedem o código do telemóvel.', worker: 'Só vê as próprias horas e diárias.' };
// A profile is named after the login's departments of that type ("Secretariado", "Armazém"), else the role.
// The base Segurança, Encarregados and Colaboradores keep the singular role names ("Encarregado").
const ROLE_KEYS = ['seguranca', 'encarregados', 'colaboradores'];
const roleLabel = (r, me = state.me) => {
  const d = r === 'admin' ? [] : [...new Set(((me && me.depts) || []).filter((x) => x.kind === r)
    .map((x) => (ROLE_KEYS.includes(x.key) ? ROLE_NAMES[r] : x.name)))];
  return d.length ? d.join(' · ') : ROLE_NAMES[r] || r;
};
// One login, several hats (Diogo is admin, team leader and worker). Changing hat never mixes data: the database
// decides what each profile sees, and nobody validates their own hours in any of them.
// The GestNow owner inside a client company (Clientes) has only the admin profile there: «Simular perfis» gives him
// the five, with a test person of that company behind them (sql/61), to see the app as encarregado or colaborador.
const canSimulate = () => isOwner() && !!state.platform.can_simulate && state.me.role === 'admin' && state.me.profiles.length < 2;
async function startSimulation() {
  const fd = await askSheet('Simular perfis', `<p>Para veres a app como <b>encarregado</b> ou <b>colaborador</b> em ${esc(state.platform.tenant || 'esta empresa')}.</p>
    <p class="small muted">A tua conta fica com os 5 perfis aqui. Para os perfis de obra é criada uma pessoa de teste, «Teste Dono (simulação)», sem cartão e sem obra. Apaga-se com os outros dados de teste antes do uso real.</p>`, 'Simular');
  if (!fd) return false;
  const { data, error } = await sb.rpc('platform_simulate_profiles');
  if (error) { toast(friendly(error)); return false; }
  state.me.profiles = data.profiles; state.me.collaborator_id = data.person;
  return true;
}
async function switchProfile() {
  if (state.me && !state.offline && canSimulate() && !(await startSimulation())) return;
  const me = state.me; if (!me || me.profiles.length < 2 || state.offline) return;
  const opts = PROFILE_ORDER.filter((r) => me.profiles.includes(r));
  const fd = await askSheet('Mudar de perfil', `<p class="small muted">A mesma conta, outro papel. Os dados e as regras de cada papel não se misturam.</p>
    <div class="profiles" role="radiogroup">${opts.map((r) => `<label class="check prof"><input type="radio" name="p" value="${esc(r)}" ${r === me.role ? 'checked' : ''} required>
      <span><b>${esc(roleLabel(r))}</b>${r === me.role ? ' <span class="small muted">(agora)</span>' : ''}<br><span class="small muted">${esc(PROFILE_HELP[r] || '')}</span></span></label>`).join('')}</div>`, 'Mudar');
  if (!fd || fd.get('p') === me.role) return;
  const { error } = await sb.rpc('mini_switch_role', { p_role: fd.get('p') });
  if (error) return toast(friendly(error));
  state.view = (TABS[fd.get('p')] || TABS.supervisor)[0];
  toast(`Agora estás como ${roleLabel(fd.get('p'))}.`);
  boot();   // asks for the phone code when the new profile needs it
}
document.getElementById('whoami').addEventListener('click', switchProfile);
function showWho() {
  const me = state.me; const p = me.collaborator_id && state.people.find((x) => x.id === me.collaborator_id);
  const el = document.getElementById('whoami');
  const many = (me.profiles && me.profiles.length > 1) || canSimulate();
  // Two lines: the role (never cut off) and, under it, whose account this is.
  // The GestNow owner can be in any client company: the second line says which.
  const nm = isOwner() && state.platform.tenant ? state.platform.tenant : p ? p.full_name.split(' ')[0] + ' ' + p.full_name.split(' ').slice(-1)[0] : me.email;
  el.innerHTML = `${avatar(p ? p.full_name : me.email).replace('class="av ', 'class="av wav ')}<span class="wtx"><b>${esc(roleLabel(me.role))}${many ? ' ▾' : ''}</b><small>${esc(nm)}</small></span>`;
  el.setAttribute('aria-label', `${roleLabel(me.role)}, ${p ? p.full_name : me.email}${many ? '. Mudar de perfil' : ''}`);
  el.title = (p ? p.full_name : me.email) + (many ? ' · toca para mudar de perfil' : ''); el.className = 'who' + (PRIVILEGED.includes(me.role) ? ' strong' : '') + (many ? ' sw' : '');
  el.disabled = !many; el.hidden = false;
}
// Search everything (Ctrl+K or the magnifier in the top bar): the screens this login can open, and the people and sites
// already loaded for it. Nothing new is fetched, and go() and each screen still check who may open what.
const cmdk = document.getElementById('cmdk'); const cmdq = document.getElementById('cmdq'); const cmdl = document.getElementById('cmdl');
const fold = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function paletteItems(q) {
  const n = fold(q.trim()); const has = (t) => fold(t).includes(n);
  const open = (v) => { const b = nav.querySelector(`button[data-view="${v}"]`); return !!b && !b.hidden; };
  const out = [];
  nav.querySelectorAll('button[data-view]').forEach((b) => {
    if (!b.hidden && (!n || has(b.textContent))) out.push({ g: 'Ecrãs', label: b.textContent.trim(), icon: b.querySelector('use').getAttribute('href').slice(3), run: () => go(b.dataset.view) });
  });
  if (n && open('trabalhadores')) for (const p of state.people) if (has(p.full_name) || has(p.employee_number)) {
    out.push({ g: 'Pessoas', label: p.full_name, sub: [p.employee_number && 'nº ' + p.employee_number, p.job_title].filter(Boolean).join(' · '), av: true,
      run: () => { state.worker = p.id; go('ficha'); } });
  }
  if (n) for (const st of state.sites) if (has(st.title) || has(st.cost_center_code)) {
    const panel = open('painel') && st.status === 'execution';
    out.push({ g: 'Obras', label: st.title, sub: st.cost_center_code + (panel ? ' · abrir dashboard' : ''), icon: 'crane',
      run: () => { if (panel) { state.panelSite = st.id; go('painel'); } else go('obras'); } });
  }
  const acts = [];
  if (state.me.profiles && state.me.profiles.length > 1 && !state.offline) acts.push({ label: 'Mudar de perfil', icon: 'users', run: switchProfile });
  else if (canSimulate() && !state.offline) acts.push({ label: 'Simular perfis (encarregado, colaborador)', icon: 'users', run: switchProfile });
  acts.push({ label: document.documentElement.dataset.theme === 'sol' ? 'Desligar modo sol' : 'Modo sol (mais contraste ao sol)', icon: 'sun', run: () => document.getElementById('sol').click() });
  acts.push({ label: 'Sair', icon: 'out', run: signOut });
  for (const a of acts) if (!n || has(a.label)) out.push({ g: 'Ações', ...a });
  return out.slice(0, 40);
}
function renderPalette() {
  const items = paletteItems(cmdq.value); cmdl._items = items; cmdl._sel = 0;
  if (!items.length) { cmdl.innerHTML = `<p class="cmdk-none">Nada encontrado para “${esc(cmdq.value)}”.</p>`; return; }
  let g = ''; cmdl.innerHTML = items.map((x, i) => (x.g !== g ? `<p class="cmdk-g">${esc(g = x.g)}</p>` : '') +
    `<button type="button" role="option" data-i="${i}" aria-selected="${i === 0}">${x.av ? avatar(x.label) : `<span class="cmdk-ic">${ic(x.icon || 'go')}</span>`}
      <span class="grow"><b>${esc(x.label)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span>${ic('go', 'cmdk-go')}</button>`).join('');
}
function markPalette(i) {
  const all = cmdl.querySelectorAll('button[data-i]'); if (!all.length) return;
  cmdl._sel = (i + all.length) % all.length;
  all.forEach((b, k) => b.setAttribute('aria-selected', String(k === cmdl._sel)));
  all[cmdl._sel].scrollIntoView({ block: 'nearest' });
}
function runPalette(i) { const x = (cmdl._items || [])[i]; if (!x) return; closePalette(); x.run(); }
function openPalette() {
  if (!state.ready || !state.me || state.me.role === 'worker' || cmdk.open) return;
  openMore(false); cmdq.value = ''; renderPalette(); cmdk.showModal(); cmdq.focus();
}
function closePalette() { const d = document.getElementById('cmdk'); if (d && d.open) d.close(); }   // also runs from boot(), before the consts above exist
document.getElementById('search').addEventListener('click', openPalette);
document.getElementById('help').addEventListener('click', () => { if (state.ready && state.view !== 'processo') openProcessFor(state.view); });
cmdq.addEventListener('input', renderPalette);
cmdq.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); markPalette(cmdl._sel + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); markPalette(cmdl._sel - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); runPalette(cmdl._sel); }
});
cmdl.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) runPalette(Number(b.dataset.i)); });
cmdk.addEventListener('click', (e) => { if (e.target === cmdk) closePalette(); });   // tap outside the box
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); cmdk.open ? closePalette() : openPalette(); }
});
async function loadBasics() {
  const [s, p] = await Promise.all([
    core().from('projects').select('id, title, cost_center_code, status, address, timezone, country, municipality').order('title').retry(!state.offline),
    core().from('collaborators').select('id, full_name, employee_number, job_title, onboarding_status, is_active, organization_id').order('full_name').retry(!state.offline),
  ]);
  // Without network the site list comes from the phone (sites only: no names of people are kept).
  const cached = load(SITES_KEY, null);
  const usable = cached && cached.tenant_id === state.me.tenant_id;
  if (s.error && !(state.offline && usable)) toast(friendly(s.error));
  if (p.error && !state.offline) toast(friendly(p.error));
  state.sites = s.data || (usable ? cached.sites : []);
  if (s.data) store(SITES_KEY, { tenant_id: state.me.tenant_id, sites: s.data.map(({ id, title, cost_center_code, status, timezone }) => ({ id, title, cost_center_code, status, timezone })) });
  state.people = p.data || [];
  if (state.offline || state.me.role === 'worker') { state.docTypes = []; return; }
  const t = await sb.rpc('mini_document_types');
  state.docTypes = t.error ? [] : (t.data || []);
}
const activeSites = () => state.sites.filter((s) => s.status === 'execution');
function currentSite() {
  const id = load(SITE_KEY, null);
  return activeSites().find((s) => s.id === id) || activeSites()[0] || null;
}
function siteSelect(id) {
  const sites = activeSites();
  if (!sites.length) return '<p class="muted">Ainda não há obras abertas. Abre uma em <b>Obras</b>.</p>';
  const cur = currentSite();
  return `<label>Obra</label><select id="${id}">${sites.map((s) =>
    `<option value="${esc(s.id)}" ${cur && cur.id === s.id ? 'selected' : ''}>${esc(s.title)} (${esc(s.cost_center_code)})</option>`).join('')}</select>`;
}
function bindSiteSelect(id, after) {
  const el = $('#' + id); if (!el) return;
  el.onchange = () => { store(SITE_KEY, el.value); after && after(); };
}

function go(view) {
  if (!state.ready) return boot();   // never show a screen before login (and the phone code, when required)
  if (state.me.role === 'worker') view = 'minhas';   // the worker profile has one screen (the database checks the same)
  else if (state.offline && view !== 'picar' && view !== 'emergencia') { toast('Sem rede: por agora só podes picar.'); view = 'picar'; }
  stopNfc(); clearInterval(state.timer); clearInterval(state.tick); hideFlash(); openMore(false); Voice.stop(); dropRobots();
  if (state.uiEl && window.GNUI) { window.GNUI.unmount(state.uiEl); state.uiEl = null; }
  state.view = view;
  app.classList.toggle('wide', view === 'secretariado' || view === 'painel');
  const tab = view === 'ficha' ? 'trabalhadores' : view === 'fichaepi' ? 'armazem' : view;
  nav.querySelectorAll('button[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === tab));
  const cur = nav.querySelector(`button[data-view="${tab}"]`);
  nav.querySelector('button[data-more]').classList.toggle('on', !!cur && cur.parentElement.id === 'more');
  window.scrollTo(0, 0);
  ({ picar: viewClock, naobra: viewOnSite, horas: viewHours, seguranca: viewSafety, trabalhadores: viewPeople,
     ficha: viewWorker, obras: viewSites, painel: viewSitePanel, secretariado: viewOffice, minhas: viewMine, equipa: viewTeam, acolhimento: viewInduction, clientes: viewClients,
     processo: viewProcess, orcamentos: viewEstimates, lmra: viewLmra, emergencia: viewEmergency,
     armazem: viewWarehouse, fichaepi: viewPpeRecord }[view] || viewClock)();
  checkEmergencyBar();
}

// ------------------------------------------------------------------ Clientes (the GestNow owner's console, sql/59)
// The client companies, with numbers only. «Entrar» moves this login into one (and back): what it had in each company
// is kept. Only the platform owner, with the phone code, sees this screen; the database checks the same.
const isOwner = () => !!(state.platform && state.platform.platform);
async function viewClients() {
  if (!isOwner()) return viewClock();   // code guard as well as the database's
  app.innerHTML = `<div class="ph"><div><p class="ph-k">GestNow · só o dono vê</p><h1>Clientes</h1></div><button class="btn" id="newc">+ Novo cliente</button></div>
    <p class="muted lead">As empresas que usam a GestNow. Aqui só vês números, nunca nomes de pessoas. Para trabalhar numa, carrega em «Entrar»; voltas por esta lista, e o que tinhas em cada uma fica guardado.</p>
    <div id="clist">${skel(3)}</div>`;
  $('#newc').onclick = newClient;
  loadClients();
}
async function loadClients() {
  const el = $('#clist'); if (!el) return;
  const { data, error } = await sb.rpc('platform_clients');
  if (!el.isConnected) return;
  if (error) { el.innerHTML = `<p>${esc(friendly(error))}</p>`; return; }
  const n = (v) => Number(v || 0).toLocaleString('pt-PT');
  el.innerHTML = `<div class="clients">${data.map((c) => `<article class="card client${c.here ? ' here' : ''}">
      <div class="cl-top">${avatar(c.name).replace('class="av ', 'class="av cl-av ')}<div class="grow"><b>${esc(c.name)}</b>
        <small>${c.demo ? 'Empresa fictícia, para testes' : 'NIF ' + esc(c.tax_id)}</small></div>
        ${c.here ? chip('ok', 'Estás aqui', 'ok') : c.demo ? chip('warn', 'fictícia') : chip('info', 'real')}</div>
      <div class="cl-stats"><span><b>${n(c.sites)}</b>obras</span><span><b>${n(c.people)}</b>pessoas</span><span><b>${n(c.taps_7d)}</b>picagens 7 dias</span><span><b>${n(c.induction)}</b>partes de acolhimento</span></div>
      <div class="cl-act">${c.here ? (c.demo && !Number(c.sites) ? `<button class="btn wide" data-fill>${ic('auto')}Preencher com dados de exemplo</button>`
          : `<p class="small muted">${ic('ok')} Os ecrãs da app mostram agora os dados desta empresa.</p>`)
        : c.open ? `<button class="btn wide ghost" data-enter="${esc(c.id)}">${ic('go')}Entrar</button>`
        : `<p class="small muted">${ic('lock')} Esta empresa não te deu acesso. Pede acesso de suporte ao administrador dela.</p>`}</div></article>`).join('')}</div>`;
  el.querySelectorAll('[data-enter]').forEach((b) => b.onclick = () => enterClient(b.dataset.enter, b));
  if (el.querySelector('[data-fill]')) el.querySelector('[data-fill]').onclick = (e) => fillDemo(e.currentTarget);
}
async function enterClient(id, btn) {
  // Taps still waiting on this phone belong to the company they were made in: send them first.
  if (queue().some((x) => !x._u || x._u === state.me.user_id)) return toast('Há picagens por enviar neste telemóvel. Espera que sejam enviadas e tenta outra vez.');
  btn.disabled = true;
  const { data, error } = await sb.rpc('platform_enter_client', { p_tenant: id });
  if (error) { btn.disabled = false; return toast(friendly(error)); }
  Object.assign(state, { sites: [], people: [], indItems: null, bot: null, worker: null, panelSite: null });
  toast(`Agora estás em ${data.tenant}.`);
  state.view = 'clientes'; boot();
}
async function fillDemo(btn) {
  btn.disabled = true; btn.lastChild.textContent = 'A preencher…';
  const { data, error } = await sb.rpc('platform_fill_demo');
  if (error) { btn.disabled = false; btn.lastChild.textContent = 'Preencher com dados de exemplo'; return toast(friendly(error)); }
  toast(`Pronto: ${data.sites} obras, ${data.people} pessoas e ${data.taps} picagens das últimas duas semanas.`);
  state.view = 'clientes'; boot();
}
async function newClient() {
  const fd = await askSheet('Novo cliente', `
    <label for="cn">Nome da empresa</label><input id="cn" name="name" required minlength="2" maxlength="120" placeholder="ex.: Montagens Industriais, Lda">
    <label class="check inline"><input type="checkbox" name="demo" id="cd" checked> Empresa fictícia, só para testes</label>
    <div id="ctx"><label for="ct">NIF</label><input id="ct" name="tax" inputmode="text" maxlength="32" placeholder="ex.: 509999999">
      <p class="small muted">Numa empresa fictícia podes deixar em branco.</p></div>
    <p class="small muted">A empresa fica pronta a usar: departamentos, tipos de documentos e modo simples. Entras nela como administrador.</p>`, 'Criar', (dlg) => {
    const sync = () => { dlg.querySelector('#ct').required = !dlg.querySelector('#cd').checked; };
    dlg.querySelector('#cd').onchange = sync; sync();
  });
  if (!fd) return;
  const { error } = await sb.rpc('platform_create_client', { p_name: String(fd.get('name') || '').trim(), p_tax_id: String(fd.get('tax') || '').trim() || null, p_demo: !!fd.get('demo') });
  if (error) return toast(friendly(error));
  toast('Cliente criado. Carrega em «Entrar» para trabalhar nele.'); loadClients();
}

// ------------------------------------------------------------------ A minha equipa (the team leader's start screen)
// One site at a time: who is in, who has not arrived, who may not enter, and what is waiting for the team leader.
function viewTeam() {
  if (!canSiteDetails()) return viewClock();   // code guard as well as the database's
  const today = new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
  app.innerHTML = `<div class="ph"><div><p class="ph-k">${esc(today)}</p><h1>A minha equipa</h1></div></div>
    <div class="team-site">${siteSelect('tsite')}</div>
    <div id="tkpis">${skel(1)}</div>
    <div class="team-acts"><button class="btn big" id="tpic">${ic('tap')}Picar a equipa</button><button class="btn big ghost" id="tval">${ic('ok')}Validar a semana</button>
      ${canLmra() ? `<button class="btn big ghost" id="tlmra">${ic('shield')}LMRA</button>` : ''}${canEmergency() ? `<button class="btn big danger" id="temer">${ic('warn')}Emergência</button>` : ''}
      <button class="btn ghost wide look" id="tlook">${ic('card')}<span><b>O colaborador quer ver as horas</b><small>Ele encosta o cartão dele ao teu telemóvel</small></span></button></div>
    <div id="talert"></div>
    <div id="treq"></div>
    <div class="sec-h"><h2 class="eyebrow">Hoje na obra</h2></div><div id="tlist">${skel(4)}</div>`;
  bindSiteSelect('tsite', loadTeam);
  $('#tpic').onclick = () => go('picar');
  $('#tval').onclick = () => go('horas');
  if ($('#tlmra')) $('#tlmra').onclick = () => go('lmra');
  if ($('#temer')) $('#temer').onclick = () => go('emergencia');
  $('#tlook').onclick = () => cardGlance(currentSite() && currentSite().id);
  loadTeam();
  state.timer = setInterval(() => { if (state.view === 'equipa' && document.visibilityState === 'visible') loadTeam(); }, 60000);
}
let teamSeq = 0;
async function loadTeam() {
  const site = currentSite(); const el = $('#tlist'); if (!el) return;
  if (!site) { el.innerHTML = `<div class="card">${empty('box', 'Sem obras abertas', 'Quando tiveres uma obra, a tua equipa aparece aqui.')}</div>`; $('#tkpis').innerHTML = ''; return; }
  const seq = ++teamSeq; const tz = siteTz(site.id);
  const [{ data: team, error }, room] = await Promise.all([sb.rpc('mini_team_today', { p_project: site.id }), sb.rpc('mini_control_room')]);
  if (seq !== teamSeq || !el.isConnected) return;
  if (error) { el.innerHTML = `<p>${esc(friendly(error))}</p>`; return; }
  const s = ((room.data && room.data.sites) || []).find((x) => x.id === site.id) || {};
  const n = (k) => team.filter((p) => p.state === k).length;
  const blocked = team.filter((p) => p.blocked).length;
  $('#tkpis').innerHTML = `<div class="kpis k4 team-kpis">
    <div class="kpi ok"><b>${n('in')}<small>/${team.length}</small></b><span>na obra agora</span></div>
    <div class="kpi ${n('absent') ? 'warn' : ''}"><b>${n('absent')}</b><span>ainda não chegaram</span></div>
    <div class="kpi ${blocked ? 'bad' : ''}"><b>${blocked}</b><span>não podem entrar</span></div>
    <button class="kpi ${s.to_validate ? 'info' : ''}" data-go="horas"><b>${s.to_validate || 0}</b><span>dias por validar</span></button></div>`;
  $('#tkpis').querySelector('[data-go]').onclick = () => go('horas');
  $('#talert').innerHTML = s.missing_out ? `<div class="result warn">${ic('warn')}<div><b>${s.missing_out} saída(s) em falta nos últimos 7 dias</b>Marca-as em Horas, com o motivo.</div></div>` : '';
  if (!team.length) { el.innerHTML = `<div class="card">${empty('box', 'Ninguém atribuído a esta obra', 'O escritório atribui as pessoas à obra em Pessoas.')}</div>`; return; }
  const ST = { in: (p) => chip('val', 'na obra desde ' + fmtHour(p.first_in, tz), 'ok'), left: (p) => chip('', 'saiu às ' + fmtHour(p.last_at, tz)),
    absent: () => chip('reg', 'ainda não picou') };
  el.innerHTML = `<div class="card team-list">${team.map((p) => `<button class="tm ${p.state}" data-id="${esc(p.id)}">
      <span class="tm-av">${avatar(p.name)}<i></i></span><span class="grow"><b>${esc(p.name)}</b><small>${esc(p.number || '')}</small></span>
      <span class="tags">${p.blocked ? chip('anom', 'não pode entrar: faltam documentos', 'warn') : ST[p.state](p)}</span></button>`).join('')}</div>`;
  el.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => { state.worker = b.dataset.id; go('ficha'); });
  loadPending('#treq', site.id);
}
// What waits for an answer: workers' disagreements with a day and their requests for holidays or absences.
// Team leader: one site, gives the first word on requests. Office: every site, decides.
async function loadPending(sel, project) {
  const box = $(sel); if (!box) return;
  const { data: d, error } = await sb.rpc('mini_pending_requests', project ? { p_project: project } : {});
  if (!box.isConnected) return;
  if (error) { box.innerHTML = ''; return; }
  const office = !project;
  const n = d.disputes.length + d.absences.length;
  if (!n) { box.innerHTML = office ? `<div class="card"><h2 style="margin-top:0">Pedidos e reclamações</h2><p class="small muted">${ic('ok')} Nada à espera de resposta.</p></div>` : ''; return; }
  box.innerHTML = `<div class="card pend-card"><div class="sec-h" style="margin-top:0"><h2>${office ? 'Pedidos e reclamações' : 'Pedidos da equipa'}</h2><span class="count">${n}</span></div>
    ${d.disputes.map((x) => { const tz = x.tz || DEFAULT_TZ; return `<div class="req open"><div class="req-h">${avatar(x.name)}<span class="grow"><b>${esc(x.name)}</b>
        <small>não concorda com ${esc(dayLabel(x.day))} · ${esc(x.code)} · ${esc(fmtHour(x.first_in, tz) || '?')}–${esc(fmtHour(x.last_out, tz) || '?')} · ${esc(fmtMin(x.worked))}</small></span></div>
      <p class="small"><b>${esc(DISPUTE_REASON[x.reason] || x.reason)}</b>${x.note ? ` · «${esc(x.note)}»` : ''}</p>
      <div class="acts"><button class="btn small" data-dfix="${esc(x.id)}">Corrigi</button><button class="btn ghost small" data-dkeep="${esc(x.id)}">Mantenho</button>
        <button class="btn ghost small" data-dgo="${esc(x.day)}">Ver o dia em Horas</button></div></div>`; }).join('')}
    ${d.absences.map((a) => `<div class="req open"><div class="req-h">${avatar(a.name)}<span class="grow"><b>${esc(a.name)}</b>
        <small>${esc(ABS_KIND[a.kind] || a.kind)} · ${esc(absWhen(a))}${a.from !== a.to ? ` · ${a.days} dia(s) úteis` : ''}</small></span>
        ${office && a.sup_ok ? chip('val', 'encarregado de acordo', 'ok') : ''}</div>
      ${a.note ? `<p class="small">«${esc(a.note)}»</p>` : ''}${office && a.sup_note ? `<p class="small muted">Encarregado: «${esc(a.sup_note)}»</p>` : ''}
      <div class="acts"><button class="btn small" data-aok="${esc(a.id)}">${office ? 'Aprovar' : 'De acordo'}</button><button class="btn ghost small" data-ano="${esc(a.id)}">Recusar</button></div></div>`).join('')}</div>`;
  const reload = () => loadPending(sel, project);
  const answer = async (id, fixed) => {
    const fd = await askSheet(fixed ? 'Corrigido' : 'Mantenho as horas', `<label for="ans">Resposta para o trabalhador</label>
      <textarea id="ans" name="ans" rows="3" required minlength="10" maxlength="500" placeholder="${fixed ? 'ex.: acrescentei a entrada das 06:45' : 'ex.: a câmara da portaria mostra entrada às 07:10'}"></textarea>`, 'Enviar resposta');
    if (!fd) return;
    const { error: e } = await sb.rpc('mini_answer_dispute', { p_id: id, p_fixed: fixed, p_answer: String(fd.get('ans') || '').trim() });
    if (e) return toast(friendly(e)); toast('Resposta enviada. O trabalhador vê-a nas suas horas.'); reload();
  };
  const decide = async (id, ok) => {
    let note = null;
    if (!ok) { const fd = await askSheet('Recusar o pedido', '<label for="why">Porquê</label><textarea id="why" name="why" rows="3" required minlength="10" maxlength="500"></textarea>', 'Recusar');
      if (!fd) return; note = String(fd.get('why') || '').trim(); }
    const { error: e } = await sb.rpc(office ? 'mini_absence_decide' : 'mini_absence_opinion', { p_id: id, p_ok: ok, p_note: note });
    if (e) return toast(friendly(e));
    toast(ok ? (office ? 'Pedido aprovado.' : 'De acordo. O pedido seguiu para o escritório.') : 'Pedido recusado. O trabalhador vê o motivo.'); reload();
  };
  box.querySelectorAll('[data-dfix]').forEach((b) => b.onclick = () => answer(b.dataset.dfix, true));
  box.querySelectorAll('[data-dkeep]').forEach((b) => b.onclick = () => answer(b.dataset.dkeep, false));
  box.querySelectorAll('[data-dgo]').forEach((b) => b.onclick = () => go('horas'));
  box.querySelectorAll('[data-aok]').forEach((b) => b.onclick = () => decide(b.dataset.aok, true));
  box.querySelectorAll('[data-ano]').forEach((b) => b.onclick = () => decide(b.dataset.ano, false));
}

// ------------------------------------------------------------------ Picar
function viewClock() {
  const nfcOk = 'NDEFReader' in window;
  // One dark "terminal" panel: clock, site, the card reader and the direction. Everything else sits beside it (computer) or under it (phone).
  app.innerHTML = `<div class="pic-grid"><div>
    <section class="pic-hero">
      <div class="pic-top"><h1>Picar</h1><span class="live" id="live" hidden></span></div>
      <div class="clock" id="clk"></div><div class="clkday" id="clkday"></div>
      ${state.offline ? `<div class="result warn">${ic('cloud')}<div><b>Sem rede</b>Só podes picar. As picagens ficam guardadas neste telemóvel e são enviadas quando a rede voltar.</div></div>` : ''}
      <div id="clockwarn"></div>
      <div class="pic-site">${siteSelect('site')}</div>
      ${nfcOk ? `<button class="tapzone" id="nfc" aria-pressed="false"><span class="ring">${ic('tap')}</span><b id="nfclbl">Tocar para ligar o leitor</b>
          <span class="small" id="nfchelp">Depois é só encostar o cartão às costas do telemóvel.</span></button>`
        : `<div class="nonfc">${ic('key')}<span>Este aparelho não lê cartões pelo browser (só o Chrome em Android). Usa o leitor USB ou escreve o número.</span></div>`}
      <div class="dir" role="group" aria-label="Direção da próxima picagem"><button class="auto" data-d="auto">${ic('auto')}AUTOMÁTICO</button>
      <button class="in" data-d="in">${ic('in')}ENTRADA</button>
      <button class="out" data-d="out">${ic('out')}SAÍDA</button></div>
      <p class="small" id="dirhelp"></p>
    </section>
    ${canEmergency() ? `<button class="btn danger wide pic-emer" id="pemer">${ic('warn')}Emergência: contar pessoas no ponto de encontro</button>` : ''}
    <div id="result" aria-live="polite"></div><div id="taplog" class="taplog"></div><div id="queue"></div>
    <form id="manual" class="manual card"><div><label for="uid">Número do cartão (ou leitor USB)</label>
      <input id="uid" name="uid" autocomplete="off" autocapitalize="characters" placeholder="ex.: 04:A1:B2:C3"></div>
      <button class="btn ghost">Picar</button></form>
    <div id="rejected"></div>
    </div><div>
    <div class="sec-h"><h2 class="eyebrow">Últimas picagens nesta obra</h2></div><div id="recent">${skel(3)}</div>
    </div></div>`;
  bindSiteSelect('site', () => { loadRecent(); loadLive(); tickClock(); });
  app.querySelectorAll('.dir button').forEach((b) => b.onclick = () => {
    state.dirOverride = b.dataset.d === 'auto' ? null : b.dataset.d; renderDir();
  });
  $('#manual').onsubmit = (e) => {
    e.preventDefault(); const input = e.target.uid;
    if (normUid(input.value)) clock(input.value); input.value = ''; input.focus();
  };
  if (nfcOk) $('#nfc').onclick = toggleNfc;
  if ($('#pemer')) $('#pemer').onclick = () => go('emergencia');
  renderDir(); renderTapLog(); showQueue(); showRejected(); showClockWarn(); loadRecent(); loadLive();
  tickClock(); state.tick = setInterval(tickClock, 1000);
  state.timer = setInterval(() => { loadRecent(); loadLive(); }, 60000);
}
// "N dentro agora", live: who is inside this site right now (the same list as Na obra). Hidden when this profile cannot see it.
let liveSeq = 0;
async function loadLive() {
  const el = $('#live'); const site = currentSite(); if (!el) return;
  if (!site || state.offline) { el.hidden = true; return; }
  const seq = ++liveSeq;
  const { data, error } = await sb.rpc('mini_on_site', { p_project: site.id });
  if (seq !== liveSeq || !$('#live')) return;
  if (error || !Array.isArray(data)) { el.hidden = true; return; }
  const n = data.length;
  el.innerHTML = `${data.slice(0, 4).map((r) => avatar(r.full_name)).join('')}<span><i></i><b>${n}</b> dentro agora</span>`;
  el.classList.toggle('none', !n); el.hidden = false;
  el.title = n ? data.map((r) => r.full_name).join(', ') : 'Ninguém dentro desta obra agora';
}
// The big clock: the server's time, in the site's time zone (what the tap will record).
function tickClock() {
  const el = $('#clk'); if (!el) return;
  const site = currentSite(); const tz = site ? siteTz(site.id) : DEFAULT_TZ; const p = tzParts(serverNow().getTime(), tz);
  el.innerHTML = `${pad2(p.hour % 24)}:${pad2(p.minute)}<small>:${pad2(p.second)}</small>`;
  const d = $('#clkday');
  if (d) d.textContent = serverNow().toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }) + ' · ' + tzName(tz);
}
// Automatic by default: the server knows if the person is inside. A forced ENTRADA or SAÍDA is for the next tap only.
function renderDir() {
  const d = state.dirOverride || 'auto';
  app.querySelectorAll('.dir button').forEach((x) => x.classList.toggle('on', x.dataset.d === d));
  const help = $('#dirhelp'); if (!help) return;
  help.textContent = d === 'auto' ? 'Automático: entra quem está fora e sai quem está dentro. Toca em ENTRADA ou SAÍDA só para forçar a próxima picagem.'
    : `A próxima picagem fica como ${d === 'in' ? 'ENTRADA' : 'SAÍDA'}. Depois volta ao automático.`;
}

async function toggleNfc() {
  if (state.nfc) { stopNfc(); return; }
  try {
    const ctrl = new AbortController(); const reader = new NDEFReader();
    await reader.scan({ signal: ctrl.signal });
    state.nfc = ctrl; nfcLook(true);
    let last = { uid: '', at: 0 };
    reader.onreading = (ev) => {
      const uid = normUid(ev.serialNumber);
      if (!uid) { beep(false); return showResult('bad', 'Cartão sem número', 'Este cartão não mostra o número. Usa outro tipo de cartão.'); }
      if (uid === last.uid && Date.now() - last.at < 3000) return;   // the same tap read twice
      last = { uid, at: Date.now() }; clock(uid);
    };
    // A failed read must never sound like a tap: error buzz and a red box (B2).
    reader.onreadingerror = () => { beep(false); showResult('bad', 'NÃO LIDO', 'Não consegui ler o cartão. Encosta outra vez, devagar.'); };
  } catch (err) {
    toast(err.name === 'NotAllowedError' ? 'Dá permissão ao NFC no Chrome.' : 'O NFC não arrancou: ' + err.message);
  }
}
function stopNfc() { if (state.nfc) { state.nfc.abort(); state.nfc = null; } nfcLook(false); }
function nfcLook(on) {
  const b = $('#nfc'); if (!b) return;
  b.classList.toggle('reading', on); b.setAttribute('aria-pressed', String(on));
  $('#nfclbl').textContent = on ? 'Encoste o cartão' : 'Tocar para ligar o leitor';
  $('#nfchelp').textContent = on ? 'O leitor está ligado. Toque aqui para desligar.' : 'Depois é só encostar o cartão às costas do telemóvel.';
}

// ---- the phone's clock: taps use the server's time (M5)
const serverNow = () => new Date(Date.now() + (state.clockOffset || 0));
async function syncClock() {
  try {
    const t0 = Date.now(); const { data, error } = await sb.rpc('mini_server_time'); const t1 = Date.now();
    if (error || !data || t1 - t0 > 10000) return;
    state.clockOffset = new Date(data).getTime() - (t0 + t1) / 2;
    store(CLOCK_KEY, { off: state.clockOffset, at: t1 });
    showClockWarn();
  } catch (_) { /* no network: keep the last known difference */ }
}
function showClockWarn() {
  const el = $('#clockwarn'); if (!el) return;
  const off = state.clockOffset || 0;
  el.innerHTML = Math.abs(off) > 120000 ? `<div class="result warn">${ic('clock')}<div><b>Acerta a hora do telemóvel</b>
    Está ${Math.round(Math.abs(off) / 60000)} min ${off > 0 ? 'atrasado' : 'adiantado'}. As picagens usam a hora certa do servidor.
    ${more('Como acertar', '<p>Definições › Data e hora › Automática.</p>')}</div></div>` : '';
}

// ---- direction: the server decides; without network, the last direction this phone saw for the card (M7)
function lastDirLocal(raw, at) {
  const m = load(LASTDIR_KEY, {}); const x = m[cardKey(raw)];
  return x && x.d === 'in' && at - x.t < 16 * 3600000 ? 'out' : 'in';
}
function rememberDir(raw, dir, at) {
  const m = load(LASTDIR_KEY, {}); const now = Date.now();
  for (const k of Object.keys(m)) if (now - m[k].t > 24 * 3600000) delete m[k];   // only the last day is useful
  m[cardKey(raw)] = { d: dir, t: at }; store(LASTDIR_KEY, m);
}
async function nextDirection(project, raw, at) {
  if (!state.offline && navigator.onLine !== false) {
    try {
      const { data, error } = await sb.rpc('mini_next_direction', { p_project: project, p_capture: 'card_on_supervisor_phone', p_raw: raw, p_at: at.toISOString() });
      if (!error && (data === 'in' || data === 'out')) return { dir: data };
    } catch (_) { /* falls back below */ }
  }
  return { dir: lastDirLocal(raw, at.getTime()), guessed: true };
}

async function clock(rawUid) {
  const site = currentSite(); if (!site) return toast('Escolhe uma obra.');
  const seq = ++state.tapSeq;
  const raw = normUid(rawUid); const at = serverNow();
  let dir = state.dirOverride; let guessed = false;
  state.dirOverride = null; renderDir();
  if (!dir) ({ dir, guessed } = await nextDirection(site.id, raw, at));
  const ev = { p_project: site.id, p_capture: 'card_on_supervisor_phone', p_raw: raw, p_direction: dir,
    p_event_time: at.toISOString(), p_client_event_id: uuid(), p_device_time: new Date().toISOString() };
  const word = dir === 'in' ? 'ENTRADA' : 'SAÍDA';   // always the direction that was sent (B1)
  const r = await sendEvent(ev);
  if (seq === state.tapSeq) state.resultId = ev.p_client_event_id;   // the box below now belongs to this tap
  if (r.notSaved) { showResult('bad', 'PICAGEM NÃO GUARDADA', `${word} do cartão …${raw.slice(-4)}: sem rede e o telemóvel não deixou guardar. Anota a hora e acrescenta-a depois como picagem esquecida.`, seq); beep(false); return; }
  if (r.authLost) { showResult('warn', 'Picagem guardada', `${word} guardada. A sessão terminou: entra outra vez e ela é enviada.`, seq); beep('neutral'); checkSession(); return; }
  if (r.queued) {
    rememberDir(raw, dir, at.getTime());
    // Not checked by anyone yet: a different sound and colour from "accepted" (A3). The verdict comes when it is sent.
    showResult('warn', `${word} NÃO VERIFICADA`, `Cartão …${raw.slice(-4)} guardado sem rede${guessed ? ' (sentido pela última picagem neste telemóvel)' : ''}. Vai ser enviado quando a rede voltar e o resultado aparece aqui.`, seq);
    beep('neutral'); return;
  }
  if (r.error) { showResult('bad', 'Erro', friendly(r.error), seq); beep(false); return; }
  const d = r.data; const who = d.name || 'Cartão ' + ev.p_raw;
  if (d.status === 'accepted') {
    rememberDir(raw, dir, at.getTime());
    showResult('ok', who, `${word} aceite`, seq); beep(true);
    if (dir === 'in' && d.collaborator_id) warnExpiring(d.collaborator_id, who, word, seq);
  } else if (d.status === 'duplicate') { showResult('warn', who, `Já picou há instantes (${word})`, seq); beep(true); }
  else { showResult('bad', `${who}: NÃO ENTRA`, (d.reasons || []).map(reasonText).join(' · '), seq); beep(false); }
  loadRecent(); loadLive();
}
// After an accepted entry: say which documents are about to expire (the entry itself is never held up by this).
// Only if the screen still shows this tap: a slow answer never covers the result of the next person (A5).
async function warnExpiring(collabId, who, word, seq) {
  const { data, error } = await sb.rpc('mini_worker_documents', { p_collab: collabId });
  if (error || !data) return;
  const soon = data.filter((x) => x.state === 'a_caducar');
  if (!soon.length) return;
  const note = 'Atenção: ' + soon.map((x) => `${x.name} caduca ${x.days_left === 0 ? 'hoje' : `daqui a ${x.days_left} dia(s)`}`).join(' · ');
  const line = state.tapLog.find((x) => x.seq === seq); if (line) { line.note = note; renderTapLog(); }
  if (seq !== state.tapSeq) return;
  const el = $('#result'); if (!el) return;
  el.innerHTML = `<div class="result warn">${ic('warn')}<div><b>${esc(who)}</b>${esc(word)} aceite<div class="small" style="margin-top:6px">${esc(note)}</div></div></div>`;
}

// ---- the offline queue (C2): each tap has its own id; items leave the queue one by one, by id, only when the server answered.
// A tap the server refuses is moved to the "refused" list with the reason, never thrown away.
const queue = () => load(QUEUE_KEY, []);
function enqueue(item) {
  const q = queue(); q.push(item);
  return store(QUEUE_KEY, q) && queue().some((x) => x.p_client_event_id === item.p_client_event_id);
}
function dequeue(id) { const q = queue().filter((x) => x.p_client_event_id !== id); return store(QUEUE_KEY, q.length ? q : undefined); }
function addRejected(item, reason, name) {
  const list = load(REJECTED_KEY, []);
  if (list.some((x) => x.id === item.p_client_event_id)) return true;
  list.push({ id: item.p_client_event_id, at: item.p_event_time, dir: item.p_direction, project: item.p_project, uid: item.p_raw,
    name: name || null, collab: item._collab || null, reason, _u: item._u || null, _e: item._e || null, seen: new Date().toISOString() });
  return store(REJECTED_KEY, list);
}
// What to do with an answer: 'ok' (the server decided), 'retry' (no network, server down, login to renew) or 'refused'.
async function verdict(r) {
  if (!r.error) return 'ok';
  const msg = r.error.message || String(r.error);
  if (isNetErr(r.error, r.status) || r.status >= 500 || r.status === 408 || r.status === 429) return 'retry';
  if (r.status === 401 || /JWT|not authenticated/i.test(msg)) return 'retry';
  if (AUTH_LOST.test(msg) && await sessionGone()) return 'retry';
  return 'refused';
}
async function sendEvent(ev) {
  let r;
  try { r = await sb.rpc('clock_event', ev); } catch (e) { r = { error: e, status: 0 }; }
  const v = await verdict(r);
  if (v === 'ok') return { data: r.data };
  if (v === 'refused') return { error: r.error };
  // Never lose a tap because of the network or the login: keep it and send it later (after the next login if needed).
  const lost = AUTH_LOST.test((r.error && r.error.message) || '') && await sessionGone();
  const ok = enqueue({ ...ev, p_was_offline: true, _u: state.me && state.me.user_id, _e: state.me && state.me.email });
  showQueue();
  if (!ok) return { notSaved: true };
  return lost ? { authLost: true } : { queued: true };
}
let flushing = null;
function flushQueue() {   // one at a time: a second call waits for the running one
  if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}
async function doFlush() {
  if (!state.ready || !state.me || state.offline) return;   // only send saved taps when logged in, or they would be refused
  // A tap saved under another login waits for that person: never sent with someone else's account (M6).
  const mine = queue().filter((x) => !x._u || x._u === state.me.user_id);
  if (!mine.length) { showQueue(); return; }
  let accepted = 0; let refused = 0; let kept = 0;
  for (const item of mine) {
    const { _u, _e, _collab, ...ev } = item; void _u; void _e; void _collab;
    let r;
    try { r = await sb.rpc('clock_event', ev); } catch (e) { r = { error: e, status: 0 }; }
    const v = await verdict(r);
    if (v === 'retry') { kept = queue().filter((x) => !x._u || x._u === state.me.user_id).length; break; }   // still no network: try later
    const word = ev.p_direction === 'in' ? 'ENTRADA' : 'SAÍDA';
    const when = fmtTime(ev.p_event_time, siteTz(ev.p_project));
    if (v === 'refused') {
      // Saved in the refused list first, then taken out of the queue: never lost in between.
      if (!addRejected(item, friendly(r.error))) { kept++; continue; }
      refused++; logTap('bad', `Cartão …${String(ev.p_raw).slice(-4)}: ${word} de ${when} recusada`, friendly(r.error));
      verdictBox(ev, 'bad', `${word} RECUSADA`, friendly(r.error));
    } else {
      const d = r.data || {}; const who = d.name || `Cartão …${String(ev.p_raw).slice(-4)}`;
      if (d.status === 'rejected') {
        if (!addRejected({ ...item, _collab: d.collaborator_id }, (d.reasons || []).map(reasonText).join(' · ') || 'recusada', d.name)) { kept++; continue; }
        refused++; logTap('bad', `${who}: ${word} de ${when} NÃO ENTROU`, (d.reasons || []).map(reasonText).join(' · '));
        verdictBox(ev, 'bad', `${who}: NÃO ENTRA`, (d.reasons || []).map(reasonText).join(' · ') + ' (verificado agora, ao enviar)');
      } else {
        accepted++; logTap(d.status === 'duplicate' ? 'warn' : 'ok', `${who}: ${word} de ${when} ${d.status === 'duplicate' ? 'repetida' : 'aceite'}`, 'enviada depois (estava sem rede)');
        verdictBox(ev, d.status === 'duplicate' ? 'warn' : 'ok', who, `${word} de ${when} ${d.status === 'duplicate' ? 'repetida' : 'aceite'} (enviada agora)`);
      }
    }
    dequeue(ev.p_client_event_id);
  }
  showQueue(); showRejected();
  if (accepted || refused) {
    // The server's verdict on the saved taps, shown where the supervisor looks (A3).
    toast(`Picagens guardadas enviadas: ${accepted} aceite(s)${refused ? `, ${refused} recusada(s): vê a lista no ecrã Picar` : ''}.`);
    if (refused) beep(false);
    loadRecent();
  } else if (kept) showQueue();
}
function showQueue() {
  showNet();
  const el = $('#queue'); if (!el) return;
  const q = queue(); const me = state.me && state.me.user_id;
  const mine = q.filter((x) => !x._u || x._u === me).length; const other = q.filter((x) => x._u && x._u !== me);
  const accounts = [...new Set(other.map((x) => x._e || 'outra conta'))].join(', ');
  el.innerHTML = [mine ? `<div class="qline"><span class="chip warn">${ic('cloud')}${mine} picagem(ns) à espera de rede</span>${navigator.onLine !== false && !state.offline ? ' <button class="btn ghost small" id="flushNow">Enviar agora</button>' : ''}</div>` : '',
    other.length ? `<div class="qline"><span class="chip warn wrap">${other.length} picagem(ns) de outra conta (${esc(accounts)}), ainda não enviadas</span> <span class="small muted">Só são enviadas quando essa pessoa voltar a entrar neste telemóvel.</span></div>` : '']
    .filter(Boolean).join('');
  const b = $('#flushNow'); if (b) b.onclick = () => flushQueue();
}
// The taps the server refused after the network came back: who, when, why, and what to do (C2, A3).
function showRejected() {
  const el = $('#rejected'); if (!el) return;
  const me = state.me && state.me.user_id;
  const list = load(REJECTED_KEY, []).filter((x) => !x._u || x._u === me);
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<h2>Picagens recusadas depois de enviadas (${list.length})</h2>
    <p class="small muted">Feitas sem rede e recusadas quando a rede voltou.</p>
    ${more('O que fazer', '<p>Ficam aqui até as tratares. Se a pessoa trabalhou mesmo, acrescenta a picagem à mão (com o motivo).</p>')}
    <div class="list">${list.map((x) => `<div class="card">
      <div class="wk">${avatar(x.name || '?')}<div class="grow"><div class="nm">${esc(x.name || 'Cartão …' + String(x.uid || '').slice(-4))}</div>
        <div class="sub">${esc(fmtTime(x.at, siteTz(x.project)))} · ${x.dir === 'in' ? 'Entrada' : 'Saída'}</div></div>
        <span class="chip code">${esc((state.sites.find((s) => s.id === x.project) || {}).cost_center_code || '')}</span></div>
      <div class="tags"><span class="chip anom wrap">${ic('x')}${esc(x.reason)}</span></div>
      <div class="acts"><button class="btn small" data-addrej="${esc(x.id)}">Acrescentar à mão</button>
        <button class="btn small ghost" data-donerej="${esc(x.id)}">Já tratei</button></div></div>`).join('')}</div>`;
  el.querySelectorAll('[data-addrej]').forEach((b) => b.onclick = () => {
    const x = list.find((y) => y.id === b.dataset.addrej); if (!x) return;
    store(SITE_KEY, x.project);
    state.prefill = { who: x.collab, dir: x.dir, at: localInput(x.at, siteTz(x.project)), why: `Picagem sem rede recusada ao enviar (${x.reason}). ` };
    state.weekStart = monday(new Date(localDay(x.at, siteTz(x.project)) + 'T12:00:00'));
    go('horas');
  });
  el.querySelectorAll('[data-donerej]').forEach((b) => b.onclick = () => {
    if (!confirm('Tirar esta picagem da lista? Faz isto só depois de a teres acrescentado à mão ou confirmado que não conta.')) return;
    store(REJECTED_KEY, load(REJECTED_KEY, []).filter((y) => y.id !== b.dataset.donerej)); showRejected();
  });
}
// The big box shows the newest tap only; every tap also gets a line in the list below it.
function logTap(kind, title, text, seq) {
  state.tapLog.unshift({ kind, title, text, seq, at: new Date() });
  state.tapLog = state.tapLog.slice(0, 6); renderTapLog();
}
function renderTapLog() {
  const el = $('#taplog'); if (!el) return;
  el.innerHTML = state.tapLog.map((x) => `<div class="tl ${x.kind}"><span class="small muted">${esc(x.at.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))}</span>
    <b>${esc(x.title)}</b> ${esc(x.text || '')}${x.note ? ` <span class="small">${esc(x.note)}</span>` : ''}</div>`).join('');
}
// The big box still shows a tap that was waiting for the network: replace "NÃO VERIFICADA" with the server's verdict.
function verdictBox(ev, kind, title, text) { if (state.resultId === ev.p_client_event_id) showResult(kind, title, text, undefined, false); }
function showResult(kind, title, text, seq, flash) {
  if (seq !== undefined) logTap(kind, title, text, seq);
  if (seq !== undefined && seq !== state.tapSeq) return;   // an older tap answering late: only its line in the list
  const el = $('#result'); if (!el) return toast(title + ': ' + text);
  el.innerHTML = `<div class="result ${kind}">${ic(RESULT_ICON[kind])}<div><b>${esc(title)}</b>${esc(text)}</div></div>`;
  if (flash !== false) showFlash(kind, title, text);
}
// The whole screen in green, red or amber for ~1.6 s: readable from a metre away, with gloves and noise. Tap to close earlier.
const RESULT_ICON = { ok: 'ok', bad: 'x', warn: 'cloud' };
function showFlash(kind, title, text) {
  const f = document.getElementById('flash'); if (!f || !state.ready) return;
  f.className = kind;
  f.innerHTML = `<div class="ficon">${ic(RESULT_ICON[kind] || 'warn')}</div><b>${esc(title)}</b><div class="ftext">${esc(text)}</div><div class="fhint">Toque para fechar</div>`;
  f.hidden = false; clearTimeout(f._h); f._h = setTimeout(hideFlash, 1600);
}
function hideFlash() { const f = document.getElementById('flash'); if (f) { clearTimeout(f._h); f.hidden = true; } }
document.getElementById('flash').addEventListener('click', hideFlash);
async function loadRecent() {
  const el = $('#recent'); const site = currentSite(); if (!el) return;
  if (!site) { el.innerHTML = empty('helmet', 'Sem obra', 'Abre uma obra em Obras.'); return; }
  if (state.offline) { el.innerHTML = empty('box', 'Sem rede', 'As últimas picagens aparecem quando a rede voltar.'); return; }
  const { data, error } = await core().from('time_events')
    .select('id, event_time, direction, status, reasons, collaborator_id, raw_uid')
    .eq('project_id', site.id).order('event_time', { ascending: false }).limit(15);
  if (error) { el.innerHTML = `<p class="muted">${esc(friendly(error))}</p>`; return; }
  if (!data.length) { el.innerHTML = `<div class="card">${empty('card', 'Ainda ninguém picou nesta obra', 'Escolhe ENTRADA ou AUTOMÁTICO e encosta o primeiro cartão.')}</div>`; return; }
  const name = (id) => (state.people.find((p) => p.id === id) || {}).full_name;
  const today = localDay(new Date().toISOString(), site.timezone);
  el.innerHTML = `<div class="list feed">${data.slice(0, 8).map((e) => { const who = name(e.collaborator_id) || 'Cartão ' + (e.raw_uid || '?');
    const when = localDay(e.event_time, site.timezone) === today ? fmtHour(e.event_time, site.timezone) : fmtTime(e.event_time, site.timezone);
    const dir = e.direction === 'in' ? 'Entrada' : e.direction === 'out' ? 'Saída' : e.direction;
    return `<div class="card ${e.direction === 'in' ? 'd-in' : 'd-out'}"><div class="wk">${avatar(who)}<div class="grow"><div class="nm">${esc(who)}</div><div class="sub">${ic(e.direction === 'in' ? 'in' : 'out')}${esc(dir)} · ${esc(when)}</div></div>
      ${e.status === 'accepted' ? chip('ok', 'aceite', 'ok') : e.status === 'duplicate' ? chip('warn', 'repetida') : chip('bad', 'recusada', 'x')}</div>
      ${e.status !== 'accepted' && e.status !== 'duplicate' && (e.reasons || []).length ? `<div class="note small muted" style="margin:6px 0 0 56px">${esc(e.reasons.map(reasonText).join(' · '))}</div>` : ''}</div>`; }).join('')}</div>
    <p class="small muted">Horas: ${esc(tzName(site.timezone || DEFAULT_TZ))}.</p>`;
}

// ------------------------------------------------------------------ Na obra
function viewOnSite() {
  if (!state.onsiteFilter) state.onsiteFilter = 'all';
  app.innerHTML = `<div class="ph"><div><p class="ph-k">Ao vivo</p><h1>Na obra agora</h1></div></div>
    <div class="toolbar noprint"><div class="tb-site">${siteSelect('site')}</div>
    ${canSiteDetails() ? `<button class="btn ghost" id="openPanel">${ic('crane')}Dashboard da obra</button>` : ''}</div>
    <div id="list" style="margin-top:14px">${skel(4)}</div>
    <p class="noprint"><button class="btn ghost wide" id="print">${ic('print')}Imprimir lista (emergência)</button></p>`;
  bindSiteSelect('site', () => { $('#list').innerHTML = skel(4); loadOnSite(); });
  $('#print').onclick = () => { state.onsiteFilter = 'in'; renderOnSite(); window.print(); };
  if ($('#openPanel')) $('#openPanel').onclick = () => { const st = currentSite(); if (st) { state.panelSite = st.id; go('painel'); } };
  loadOnSite();
  state.timer = setInterval(loadOnSite, 30000);
}
// Who is inside (the emergency list), plus today's picture: on a break, left, and who still lacks an exit.
// "Em pausa": left less than 2 hours ago after working today (the lunch exit); after that, "Saiu".
let onSiteSeq = 0;
async function loadOnSite() {
  const el = $('#list'); const site = currentSite(); if (!el) return;
  if (!site) { el.innerHTML = `<div class="card">${empty('helmet', 'Sem obras abertas', 'Abre uma obra em Obras.')}</div>`; return; }
  const seq = ++onSiteSeq; const tz = siteTz(site.id);
  const today = localDay(new Date().toISOString(), tz);
  const y = new Date(today + 'T12:00:00Z'); y.setUTCDate(y.getUTCDate() - 1); const yday = y.toISOString().slice(0, 10);
  const [on, hrs, per] = await Promise.all([sb.rpc('mini_on_site', { p_project: site.id }),
    sb.rpc('mini_hours', { p_project: site.id, p_from: yday, p_to: today }), dayPeriods(yday, today, site.id).catch(() => ({}))]);
  if (seq !== onSiteSeq || !$('#list')) return;
  if (on.error) { el.innerHTML = `<p>${esc(friendly(on.error))}</p>`; return; }
  const rows = hrs.error ? null : hrs.data || [];
  const nowP = tzParts(Date.now(), tz); const nowMin = (nowP.hour % 24) * 60 + nowP.minute;
  const people = new Map();
  for (const r of on.data) {
    people.set(r.collaborator_id, { id: r.collaborator_id, name: r.full_name, num: r.employee_number, org: r.organization, st: 'in', since: r.since });
  }
  for (const r of rows || []) {
    const p = people.get(r.collaborator_id) || { id: r.collaborator_id, name: r.full_name, num: r.employee_number, org: r.organization };
    const missing = r.shift_date < today && r.anomalies.some((a) => a === 'missing_out' || a === 'open_shift');
    if (r.shift_date === today) { p.today = r; p.periods = per[r.work_day_id]; }
    if (missing) { p.missDay = r; if (!p.today) p.periods = per[r.work_day_id]; }
    if (!p.st) {
      if (r.shift_date === today && r.last_out) {
        const ago = (Date.now() - new Date(r.last_out).getTime()) / 60000;
        p.st = ago < 120 ? 'pause' : 'out'; p.lastOut = r.last_out;
      } else if (missing) p.st = 'miss';
    }
    if (p.st) people.set(p.id, p);
  }
  // inside since an earlier day: that day still has no exit
  for (const p of people.values()) if (p.st === 'in' && p.since && localDay(p.since, tz) < today) p.st = 'miss';
  const list = [...people.values()];
  const n = (st) => list.filter((p) => p.st === st).length;
  state.onsite = { site, list, tz, today, nowMin, partial: !rows, count: on.data.length };
  renderOnSite();
}
function renderOnSite() {
  const el = $('#list'); const o = state.onsite; if (!el || !o) return;
  const { site, list, tz, nowMin } = o; const me = state.me && state.me.collaborator_id;
  const n = (st) => list.filter((p) => p.st === st).length;
  const f = state.onsiteFilter;
  const shown = list.filter((p) => f === 'all' || p.st === f || (f === 'in' && p.st === 'miss' && p.since));
  const LABEL = { in: 'Na obra', pause: 'Em pausa', out: 'Saiu', miss: 'Falta saída' };
  const filt = [['all', `Todos ${list.length}`], ['in', 'Na obra'], ['pause', 'Em pausa'], ['out', 'Saíram'], ['miss', 'Falta saída']];
  el.innerHTML = `<div class="kpis">
      <div class="kpi ok"><b>${o.count}</b><span>na obra</span></div>
      <div class="kpi info"><b>${o.partial ? '–' : n('pause')}</b><span>em pausa</span></div>
      <div class="kpi ${n('miss') ? 'warn' : ''}"><b>${o.partial ? '–' : n('miss')}</b><span>falta saída</span></div></div>
    <p class="small muted"><span class="big-count" style="font-size:20px">${o.count}</span> pessoa(s) em <b>${esc(site.title)}</b> · atualizado ${esc(new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }))}</p>
    <div class="chips noprint" role="group" aria-label="Filtrar">${filt.map(([k, t]) => `<button class="chip ${k === 'miss' ? 'warn' : ''}" data-f="${k}" aria-pressed="${f === k}">${esc(t)}</button>`).join('')}</div>
    ${shown.length ? `<div class="list">${shown.map((p) => {
      const sub = p.st === 'in' ? `entrou ${fmtHour(p.since, tz)} · há ${fmtMin(Math.max(0, Math.round((Date.now() - new Date(p.since).getTime()) / 60000)))}`
        : p.st === 'miss' ? `${p.missDay ? fmtDate(p.missDay.shift_date) : 'desde ' + fmtTime(p.since, tz)} · sem saída`
        : `saiu ${fmtHour(p.lastOut, tz)}${p.today ? ' · ' + fmtMin(p.today.worked_minutes) : ''}`;
      const kind = { in: 'ok', pause: 'info', out: '', miss: 'warn' }[p.st];
      return `<div class="card"><div class="wk">${avatar(p.name)}<div class="grow"><div class="nm">${esc(p.name)}</div>
        <div class="sub">${esc(sub)}</div>${p.org ? `<div class="sub">${esc(p.org)}${p.num ? ' · nº ' + esc(p.num) : ''}</div>` : ''}</div>
        ${chip(kind, LABEL[p.st], p.st === 'in' ? 'ok' : p.st === 'miss' ? 'warn' : '')}</div>
        ${p.periods ? dayline(p.periods, p.today && p.st !== 'miss' ? { now: nowMin, axis: true } : { axis: true }) : ''}
        ${['in', 'miss'].includes(p.st) && p.id !== me ? `<div class="acts noprint"><button class="btn small ${p.st === 'miss' ? '' : 'ghost'}" data-out="${esc(p.id)}">${ic('out')}Marcar saída</button></div>` : ''}</div>`; }).join('')}</div>`
    : `<div class="card">${empty('helmet', f === 'all' ? 'Ainda ninguém picou hoje' : 'Ninguém neste filtro', f === 'all' ? 'Quando alguém picar a entrada, aparece aqui.' : '')}</div>`}`;
  el.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { state.onsiteFilter = b.dataset.f; renderOnSite(); });
  el.querySelectorAll('button[data-out]').forEach((b) => b.onclick = async () => {
    const p = list.find((x) => x.id === b.dataset.out); if (!p) return;
    // the day that lacks the exit: an earlier day first, otherwise today's open shift
    const d = p.missDay || (p.st === 'in' && p.since ? null : p.today);
    const since = d ? d.first_in : p.since;
    const day = d ? d.shift_date : localDay(p.since || new Date().toISOString(), tz);
    if (await markOut({ id: p.id, name: p.name, day, since, project: site.id })) loadOnSite();
  });
}

// ------------------------------------------------------------------ Trabalhadores
async function viewPeople() {
  app.innerHTML = `<div class="ph"><div><p class="ph-k">Equipa</p><h1>Trabalhadores</h1></div>
    ${canPeople() ? `<button class="btn" id="new">+ Novo trabalhador</button>` : ''}</div>
    <div id="pboard"></div><div id="list">${skel(4)}</div>
    ${canPeople() ? `
    <div class="card" id="newcard" hidden><h2 style="margin-top:0">Novo trabalhador</h2>
    <p class="small muted">Só para quem ainda não está na lista.</p>
    <form id="f"><div class="row"><div><label>Nome completo *</label><input name="name" required></div>
      <div><label>NIF *</label><input name="nif" inputmode="numeric" required></div></div>
      <div class="row"><div><label>Nº de trabalhador</label><input name="num"></div>
      <div><label>Função</label><input name="job" placeholder="ex.: Serralheiro"></div></div>
      <fieldset class="onbmode"><legend>Acolhimento</legend>
        <label class="opt"><input type="radio" name="mode" value="paper" checked><span><b>Já verifiquei em papel</b><small>Fica ativo já e pode picar com o cartão.</small></span></label>
        <label class="opt"><input type="radio" name="mode" value="app"><span><b>Faz o acolhimento na app</b><small>Vê os vídeos e manuais no telemóvel dele. O cartão associa-se quando acabar.</small></span></label></fieldset>
      <div class="row paper-only"><div><label>Cartão</label><input name="card" autocomplete="off" placeholder="Encosta o cartão ou escreve o número"></div>
      ${'NDEFReader' in window ? '<div style="flex:0 0 auto"><button type="button" class="btn ghost" id="read">Ler cartão</button></div>' : ''}</div>
      ${siteSelect('site')}
      <h2>Documentos que travam a entrada</h2>
      <p class="small muted">Sem estes válidos, a pessoa não entra na obra.</p>
      ${more('Como preencher', '<p>Copia as datas do papel e tira uma foto ao documento (ou escolhe o PDF). Se ainda não os tens, deixa em branco e regista depois na ficha.</p>')}
      ${state.docTypes.filter((t) => t.is_blocking).map((t) => `<fieldset class="doc" data-type="${esc(t.id)}"><legend>${esc(t.name)}</legend>
        <div class="row"><div><label>Data de emissão</label><input name="i_${esc(t.id)}" type="date" max="${isoDay(new Date())}"></div>
        <div><label>Válido até (vazio = não caduca)</label><input name="e_${esc(t.id)}" type="date"></div></div>
        <label>Foto ou PDF do documento</label><input name="f_${esc(t.id)}" type="file" accept="${FILE_ACCEPT}"></fieldset>`).join('')}
      <label class="check paper-only"><input type="checkbox" name="seen" required> Vi em papel a identificação e o contrato desta pessoa *</label>
      <label>Notas (opcional)</label><input name="notes" placeholder="ex.: contrato a termo até 12/2026">
      <p class="small muted">Fica guardado, com o teu nome, como prova do que verificaste.</p>
      <p><button class="btn big">Guardar</button></p></form></div>` : ''}`;
  if ($('#f')) {
    $('#new').onclick = () => { $('#newcard').hidden = false; $('#new').hidden = true; $('#newcard').scrollIntoView({ behavior: 'smooth' }); };
    app.insertBefore($('#newcard'), $('#list'));
    bindSiteSelect('site');
    if ($('#read')) $('#read').onclick = () => readOneCard('input[name=card]');
    const syncMode = () => { const app1 = $('#f').querySelector('input[name=mode]:checked').value === 'app';
      $('#f').querySelectorAll('.paper-only').forEach((x) => { x.hidden = app1; x.querySelectorAll('input').forEach((i) => { i.disabled = app1; }); }); };
    $('#f').querySelectorAll('input[name=mode]').forEach((r) => r.onchange = syncMode); syncMode();
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const docs = [...e.target.querySelectorAll('fieldset.doc')].map((fs) => ({ type: fs.dataset.type,
        name: fs.querySelector('legend').textContent, issue: f.get('i_' + fs.dataset.type), expiry: f.get('e_' + fs.dataset.type),
        file: fs.querySelector('input[type=file]').files[0] }));
      const half = docs.find((d) => !d.issue && (d.expiry || d.file));
      if (half) return toast(`${half.name}: falta a data de emissão.`);
      for (const d of docs.filter((x) => x.issue)) { const bad = fileProblem(d.file); if (bad) return toast(`${d.name}: ${bad}`); }
      const nif = String(f.get('nif') || '').replace(/\s/g, '');
      const dup = await findByNif(nif);
      if (dup) return offerExisting(dup);
      const btn = e.target.querySelector('.btn:not(.ghost)'); btn.disabled = true;
      const notes = String(f.get('notes') || '').trim();
      const viaApp = f.get('mode') === 'app';
      const { data, error } = viaApp
        ? await sb.rpc('mini_add_worker_onboarding', { p_full_name: f.get('name'), p_tax_number: nif, p_employee_number: f.get('num'),
          p_project: $('#site') ? $('#site').value : null, p_job_title: f.get('job') })
        : await sb.rpc('mini_add_worker', {
        p_full_name: f.get('name'), p_tax_number: nif, p_employee_number: f.get('num'),
        p_card_uid: normUid(f.get('card')), p_project: $('#site') ? $('#site').value : null,
        p_statement: 'Identificação e contrato vistos em papel.' + (notes ? ' ' + notes : ''), p_job_title: f.get('job') });
      if (error) {
        btn.disabled = false;
        if (/tax_number/i.test(error.message || '')) { const d2 = await findByNif(nif); if (d2) return offerExisting(d2); }
        return toast(friendly(error));
      }
      let failed = 0;
      for (const d of docs.filter((x) => x.issue)) {
        const r = await addDocument(data, d.type, d.issue, d.expiry, null, d.file);
        if (r.error) { failed++; toast(d.name + ': ' + friendly(r.error)); }
      }
      btn.disabled = false;
      const missing = docs.filter((x) => !x.issue).length + failed;
      toast(viaApp ? 'Guardado. Agora cria-lhe a conta na app (na ficha, «Conta na app») para ele começar o acolhimento.'
        : missing ? 'Trabalhador guardado. Faltam documentos: regista-os na ficha.' : 'Trabalhador guardado, pronto para picar.');
      await loadBasics(); state.worker = data; go('ficha');
    };
  }
  if (canPeople()) loadOnbBoard('#pboard', true);
  const { data, error } = await sb.rpc('mini_workers');
  const el = $('#list'); if (!el) return;
  if (error) { el.innerHTML = `<p class="muted">${esc(friendly(error))}</p>`; return; }
  if (!data.length) { el.innerHTML = `<div class="card">${empty('helmet', 'Ainda não há trabalhadores', canPeople() ? 'Toca em «+ Novo trabalhador» para registar o primeiro.' : 'O escritório regista as pessoas.')}</div>`; return; }
  const codes = (ids) => ids.map((id) => (state.sites.find((s) => s.id === id) || {}).cost_center_code).filter(Boolean);
  const okN = data.filter((w) => w.is_active && !w.blocking_problems && w.card_uid).length;
  // Quick filters by state, plus search: with 50 people nobody scrolls the whole list.
  const stOf = (w) => (!w.is_active ? 'off' : w.blocking_problems ? 'bad' : !w.card_uid ? 'card' : 'ok');
  const count = (k) => data.filter((w) => stOf(w) === k).length;
  const F = [['all', 'Todos', data.length], ['ok', 'Podem entrar', okN], ['bad', 'Bloqueados', count('bad')], ['card', 'Sem cartão', count('card')], ['off', 'Inativos', count('off')]]
    .filter(([k, , n]) => k === 'all' || n);
  if (!F.some(([k]) => k === state.peopleF)) state.peopleF = 'all';
  el.innerHTML = `<div class="pfilters"><div class="chips" role="group" aria-label="Filtrar">${F.map(([k, t, n]) =>
      `<button class="chip ${k}" data-f="${k}" aria-pressed="${state.peopleF === k}">${esc(t)} <b>${n}</b></button>`).join('')}</div>
    ${data.length > 6 ? '<input type="search" id="pq" placeholder="Procurar nome, nº ou cartão" autocomplete="off">' : ''}</div>
    <p class="small muted">${data.length} pessoa(s) · ${okN} pode(m) entrar. Toca numa pessoa para ver a ficha.</p>
    <div class="list people">${data.map((w) => `<div class="card link st-${stOf(w)}" role="button" tabindex="0" data-id="${esc(w.collaborator_id)}" data-st="${stOf(w)}"
      data-q="${esc(fold(`${w.full_name} ${w.employee_number || ''} ${w.card_uid || ''}`))}">
    <div class="wk">${avatar(w.full_name)}<div class="grow"><div class="nm">${esc(w.full_name)}</div>
      <div class="sub">${w.employee_number ? 'nº ' + esc(w.employee_number) + ' · ' : ''}${w.card_uid ? 'cartão ' + esc(w.card_uid) : 'sem cartão'}</div></div></div>
    <div class="tags">${!w.is_active ? chip('', 'inativo')
      : w.blocking_problems ? chip('bad', `não entra: ${w.blocking_problems} documento${w.blocking_problems > 1 ? 's' : ''}`, 'x')
      : !w.card_uid ? chip('warn', 'sem cartão', 'card') : chip('ok', 'pode entrar', 'ok')}
      ${codes(w.site_ids).map((c) => `<span class="chip code">${esc(c)}</span>`).join('') || '<span class="chip">sem obra</span>'}</div></div>`).join('')}</div>
    <p class="muted small" id="pnone" hidden>Ninguém com este filtro.</p>`;
  const apply = () => {
    const qv = fold(($('#pq') || {}).value || ''); let n = 0;
    el.querySelectorAll('.people > .card').forEach((c) => { const show = (state.peopleF === 'all' || c.dataset.st === state.peopleF) && c.dataset.q.includes(qv); c.hidden = !show; n += show; });
    el.querySelectorAll('.pfilters .chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === state.peopleF)));
    $('#pnone').hidden = !!n;
  };
  el.querySelectorAll('.pfilters .chip').forEach((b) => b.onclick = () => { state.peopleF = b.dataset.f; apply(); });
  if ($('#pq')) $('#pq').oninput = apply;
  apply();
  el.querySelectorAll('.link').forEach((c) => { c.onclick = () => { state.worker = c.dataset.id; go('ficha'); };
    c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.onclick(); } }; });
}

// One worker: documents, card, sites, active.
async function viewWorker() {
  const id = state.worker; if (!id) return go('trabalhadores');
  app.innerHTML = `<p class="noprint"><button class="btn ghost small" id="back">‹ Trabalhadores</button></p><div id="w">${skel(3)}</div>`;
  $('#back').onclick = () => go('trabalhadores');
  const [ws, ds, us, fs] = await Promise.all([sb.rpc('mini_workers'), sb.rpc('mini_worker_documents', { p_collab: id }),
    can('contas.gerir') ? sb.rpc('mini_app_users') : Promise.resolve({ data: [] }),
    canDocs() ? sb.rpc('mini_document_files', { p_collab: id }) : Promise.resolve({ data: [] })]);
  const files = (fs && fs.data) || [];
  const current = (typeId) => files.find((x) => x.type_id === typeId && x.is_current);
  const older = files.filter((x) => !x.is_current);
  const login = ((us && us.data) || []).find((u) => u.collaborator_id === id);
  // Departments the admin can give (Administração only goes with the admin role) and the ones this login is in.
  let depts = []; let mine = []; let adminDept = null;
  if (can('contas.gerir')) {
    const [d, m] = await Promise.all([sb.rpc('mini_departments'), login ? sb.rpc('mini_user_departments') : Promise.resolve({ data: [] })]);
    adminDept = (d.data || []).find((x) => x.kind === 'admin');
    depts = (d.data || []).filter((x) => x.is_active && x.kind !== 'admin');
    mine = ((m.data || []).filter((x) => login && x.user_id === login.user_id)).map((x) => x.department_id);
  }
  const loginAdmin = login && (login.role === 'admin' || (adminDept && mine.includes(adminDept.id)));
  const el = $('#w'); if (!el) return;
  if (ws.error || ds.error) { el.innerHTML = `<p>${esc(friendly(ws.error || ds.error))}</p>`; return; }
  const w = ws.data.find((x) => x.collaborator_id === id); if (!w) { el.innerHTML = '<p>Não encontrado.</p>'; return; }
  const docState = (d) => ({ ok: chip('ok', 'válido', 'ok'), a_caducar: chip('warn', `caduca em ${d.days_left} dia(s)`, 'clock'),
    caducado: chip('bad', 'caducado', 'x'), em_falta: d.is_blocking ? chip('bad', 'em falta', 'x') : chip('', 'não tem') }[d.state]);
  const blocked = ds.data.filter((d) => d.is_blocking && ['caducado', 'em_falta'].includes(d.state)).length;
  // Ready to enter: the documents that stop the entry, how many are in order.
  const need = ds.data.filter((d) => d.is_blocking); const fine = need.filter((d) => !['caducado', 'em_falta'].includes(d.state)).length;
  const pct = need.length ? Math.round((fine / need.length) * 100) : 100;
  el.innerHTML = `<div class="card prof-hero"><div class="prof-band"></div><div class="prof-body">
      <div class="wk">${avatar(w.full_name)}<div class="grow"><h1 style="margin:0">${esc(w.full_name)}</h1>
      <div class="sub">${w.employee_number ? 'nº ' + esc(w.employee_number) + ' · ' : ''}${esc(w.organization)}${w.job_title ? ' · ' + esc(w.job_title) : ''}</div></div></div>
      <div class="tags">${!w.is_active ? chip('', 'inativo') : blocked ? chip('bad', `não entra: ${blocked} documento${blocked > 1 ? 's' : ''}`, 'x') : chip('ok', 'ativo', 'ok')}
        ${w.card_uid ? chip('', 'cartão ' + w.card_uid, 'card') : chip('warn', 'sem cartão', 'card')}</div>
      ${need.length ? `<div class="ready ${pct === 100 ? 'ok' : 'bad'}"><div class="ready-t"><span>Pronto para entrar na obra</span><b>${fine} de ${need.length} documentos</b></div>
        <div class="prog"><i style="width:${pct}%"></i></div></div>` : ''}</div></div>
    <div class="card" id="ficha">${skel(2)}</div>
    <div class="card"><h2 style="margin-top:0">Documentos e formação</h2>
      <table class="rt"><tr><th>Documento</th><th>Validade</th><th>Estado</th></tr>${ds.data.map((d) => `<tr>
        <td><b>${esc(d.name)}</b>${d.is_blocking ? ' <span class="small muted">(trava a entrada)</span>' : ''}
          ${d.document_number ? `<div class="small muted">nº ${esc(d.document_number)}</div>` : ''}</td>
        <td data-l="Validade">${d.issue_date ? (d.expiration_date ? 'até ' + esc(fmtDate(d.expiration_date)) : 'sem validade') : ''}</td>
        <td><div class="tags" style="margin:0">${docState(d)}${canDocs() && d.issue_date && !(current(d.type_id) && current(d.type_id).file_path) ? chip('warn', 'sem comprovativo') : ''}</div>
          ${canDocs() && d.issue_date && current(d.type_id) && current(d.type_id).file_path
          ? `<div style="margin-top:8px"><button class="btn small ghost" data-file="${esc(current(d.type_id).file_path)}">Ver comprovativo</button></div>` : ''}</td></tr>`).join('')}</table>
      ${canDocs() && older.length ? `<details class="fold"><summary>Versões antigas (${older.length})</summary><div>
        <table class="rt">${older.map((x) => `<tr><td><b>${esc(x.type_name)}</b><div class="small muted">registado ${esc(fmtDate(x.registered_at))}${x.registered_by ? ' por ' + esc(x.registered_by) : ''}</div></td>
          <td>${x.expiration_date ? 'até ' + esc(fmtDate(x.expiration_date)) : 'sem validade'}</td>
          <td>${x.file_path ? `<button class="btn small ghost" data-file="${esc(x.file_path)}">Ver</button>` : '<span class="small muted">só em papel</span>'}</td></tr>`).join('')}</table></div></details>` : ''}
      ${canDocs() ? `<h2>Registar ou renovar</h2>
      <form id="doc"><label>Documento *</label><select name="type" required><option value="">Escolhe o documento…</option>${ds.data.map((d) => `<option value="${esc(d.type_id)}">${esc(d.name)}</option>`).join('')}</select>
        <div class="row"><div><label>Data de emissão *</label><input name="issue" type="date" required max="${isoDay(new Date())}"></div>
        <div><label>Válido até (vazio = não caduca)</label><input name="expiry" type="date"></div></div>
        <label>Número (opcional)</label><input name="num">
        <label>Foto ou PDF do documento *</label><input name="file" type="file" accept="${FILE_ACCEPT}" required>
        <p class="small muted">Foto nítida ou PDF, até 10 MB.</p>
        ${more('Quem vê o ficheiro', '<p>Fica guardado em privado e nunca se apaga. Só o administrador, o RH e a segurança o podem abrir. Fica escrito que foste tu a verificar, e quando.</p>')}
        <p><button class="btn wide">Guardar documento</button></p></form>` : ''}
    </div>
    ${canPeople() ? `<div class="card"><h2 style="margin-top:0">Cartão</h2>
      <p>${w.card_uid ? 'Cartão atual: <b>' + esc(w.card_uid) + '</b>' : '<b>Sem cartão.</b> Não consegue picar.'}</p>
      <form id="card"><div class="row"><div><label>Cartão novo</label><input name="card" autocomplete="off" placeholder="Encosta o cartão ou escreve o número" required></div>
        ${'NDEFReader' in window ? '<div style="flex:0 0 auto"><button type="button" class="btn ghost" id="read">Ler cartão</button></div>' : ''}</div>
        <label>Porquê? *</label><input name="why" required placeholder="ex.: cartão perdido">
        <p class="small muted">O cartão antigo deixa de funcionar logo.</p>
        <p><button class="btn wide">Trocar cartão</button></p></form></div>` : ''}
    ${can('pessoas.atribuir_obras') ? `<div class="card"><h2 style="margin-top:0">Obras</h2>
      ${activeSites().map((s) => `<label class="check"><input type="checkbox" data-site="${esc(s.id)}" ${w.site_ids.includes(s.id) ? 'checked' : ''}>
        ${esc(s.title)} (${esc(s.cost_center_code)})</label>`).join('') || '<p class="muted">Sem obras abertas.</p>'}
      <p class="small muted">Só pode picar nas obras marcadas.</p></div>` : ''}
    ${can('contas.gerir') ? `<div class="card"><h2 style="margin-top:0">Conta na app</h2>${login ? `
      <p>${esc(login.email)} · ${esc(ROLE_NAMES[login.role] || login.role)} ·
        ${login.is_active ? chip('ok', 'ligada', 'ok') : chip('', 'desligada')}</p>
      ${login.is_active ? `<form id="profs"><label>Departamentos</label><div class="chips reasons">${loginAdmin ? `<label class="chip"><input type="checkbox" checked disabled>Administração</label>` : ''}${depts.map((d) =>
        `<label class="chip"><input type="checkbox" name="d" value="${esc(d.id)}" ${mine.includes(d.id) ? 'checked' : ''}>${esc(d.name)}</label>`).join('')}</div>
        <p class="small muted">Cada departamento dá as suas permissões. Com departamentos de tipos diferentes, a pessoa muda de perfil no nome lá em cima. Nunca valida as próprias horas.</p>
        <p><button class="btn ghost wide">Guardar departamentos</button></p></form>` : ''}
      ${login.is_me ? '' : `<p><button class="btn ghost wide" id="toggleLogin">${login.is_active ? 'Desligar a conta' : 'Ligar a conta'}</button></p>`}` : w.is_active ? `
      <p class="small muted">Dá a esta pessoa acesso à app para picar, ver quem está na obra e validar horas.</p>
      <form id="login"><label>Email *</label><input name="email" type="email" required autocomplete="off">
        <label>Departamento *</label><select name="dept" required><option value="">Escolhe…</option>${depts.map((d) => `<option value="${esc(d.id)}">${esc(d.name)} (${esc(KIND_NAMES[d.kind] || d.kind)})</option>`).join('')}</select>
        ${more('O que cada departamento vê', '<p>Cada departamento só faz o que as suas permissões dizem (vê-as no Secretariado, em «Departamentos e acessos»). O colaborador só vê as horas dele, as diárias e os avisos de desconto. Escritório e segurança usam sempre a app de códigos.</p>')}
        <p><button class="btn wide">Criar conta</button></p></form><div id="newpw"></div>` : '<p class="muted">Pessoa inativa: sem conta.</p>'}</div>` : ''}
    ${canPeople() ? `<div class="card"><h2 style="margin-top:0">${w.is_active ? 'Desativar' : 'Reativar'}</h2>
      <form id="act"><label>Porquê? *</label><input name="why" required placeholder="${w.is_active ? 'ex.: terminou o contrato' : 'ex.: voltou a ser contratado'}">
      <p class="small muted">${w.is_active ? 'Deixa de poder entrar em qualquer obra e o cartão é anulado. O histórico fica guardado.' : 'Depois de reativar, dá-lhe um cartão.'}</p>
      <p><button class="btn wide ${w.is_active ? 'danger' : ''}">${w.is_active ? 'Desativar' : 'Reativar'}</button></p></form></div>` : ''}`;
  if ($('#doc')) $('#doc').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const btn = e.target.querySelector('.btn'); btn.disabled = true;
    btn.textContent = 'A enviar…';
    const { error } = await addDocument(id, f.get('type'), f.get('issue'), f.get('expiry'), f.get('num'), f.get('file'));
    btn.disabled = false; btn.textContent = 'Guardar documento';
    if (error) return toast(friendly(error));
    toast('Documento guardado com o comprovativo.'); viewWorker();
  };
  app.querySelectorAll('[data-file]').forEach((b) => b.onclick = () => openDocFile(b.dataset.file));
  if ($('#read')) $('#read').onclick = () => readOneCard('#card input[name=card]');
  if ($('#card')) $('#card').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const { error } = await sb.rpc('mini_set_card', { p_collab: id, p_card_uid: normUid(f.get('card')), p_reason: f.get('why') });
    if (error) return toast(friendly(error));
    toast('Cartão trocado.'); viewWorker();
  };
  app.querySelectorAll('input[data-site]').forEach((cb) => cb.onchange = async () => {
    const { data, error } = await sb.rpc('mini_assign_worker', { p_collab: id, p_project: cb.dataset.site, p_on: cb.checked });
    if (error) { cb.checked = !cb.checked; return toast(friendly(error)); }
    toast(cb.checked ? 'Pode picar nesta obra a partir de hoje.' : data === 'amanha'
      ? 'Foi posto nesta obra hoje: só deixa de poder picar a partir de amanhã.' : 'Já não pode picar nesta obra.');
  });
  if ($('#login')) $('#login').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const btn = e.target.querySelector('.btn'); btn.disabled = true;
    const dept = depts.find((d) => d.id === f.get('dept')); if (!dept) { btn.disabled = false; return toast('Escolhe o departamento.'); }
    const { data, error } = await sb.functions.invoke('mini-criar-conta', { body: { email: f.get('email'), collaborator_id: id, role: dept.kind } });
    btn.disabled = false;
    let msg = error && error.message;
    if (error && error.context && error.context.json) { try { msg = (await error.context.json()).error || msg; } catch (_) {} }
    if (error) return toast(friendly({ message: msg }));
    const { error: de } = await sb.rpc('mini_set_user_departments', { p_user: data.user_id, p_depts: [dept.id] });
    if (de) toast('Conta criada, mas o departamento não ficou guardado: ' + friendly(de));
    e.target.hidden = true;
    $('#newpw').innerHTML = `<div class="result warn">${ic('key')}<div><b>${esc(data.password)}</b>Palavra-passe temporária de ${esc(data.email)}</div></div>
      <p><b>Dá-a à pessoa em mão ou diz-lha de viva voz.</b> Não a envies por mensagem nem email. Só aparece agora.
      No primeiro login, a pessoa escolhe a sua palavra-passe.</p><p><button class="btn wide" id="pwdone">Já entreguei</button></p>`;
    $('#pwdone').onclick = () => viewWorker();
  };
  if ($('#profs')) $('#profs').onsubmit = async (e) => {
    e.preventDefault();
    const ids = [...e.target.querySelectorAll('input[name=d]')].filter((c) => c.checked).map((c) => c.value);
    const { error } = await sb.rpc('mini_set_user_departments', { p_user: login.user_id, p_depts: ids });
    if (error) return toast(friendly(error));
    toast('Departamentos guardados.');
    if (login.is_me) return boot();
    viewWorker();
  };
  if ($('#toggleLogin')) $('#toggleLogin').onclick = async () => {
    const why = prompt(login.is_active ? 'Porque é que desligas esta conta?' : 'Porque é que ligas outra vez esta conta?');
    if (!why) return;
    const { error } = await sb.rpc('mini_set_user_active', { p_user: login.user_id, p_active: !login.is_active, p_reason: why });
    if (error) return toast(friendly(error));
    toast(login.is_active ? 'Conta desligada.' : 'Conta ligada.'); viewWorker();
  };
  if ($('#act')) $('#act').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    if (w.is_active && !confirm(`Desativar ${w.full_name}? Deixa de poder entrar em qualquer obra.`)) return;
    const { error } = await sb.rpc('mini_set_worker_active', { p_collab: id, p_active: !w.is_active, p_reason: f.get('why') });
    if (error) return toast(friendly(error));
    toast(w.is_active ? 'Desativado.' : 'Reativado. Dá-lhe um cartão.'); await loadBasics(); viewWorker();
  };
  loadWorkerProfile(id);
}

// ------------------------------------------------------------------ Ficha do colaborador (a ficha de papel da empresa)
// Work data and uniform sizes: whoever sees people. Personal data: only with pessoas.dados_pessoais (the server
// does not even send it otherwise). Uniform sizes will feed the PPE module.
const SIZES_TOP = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const SIZES_BOTTOM = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const SIZES_SHOES = Array.from({ length: 17 }, (_, i) => String(34 + i));
const COUNTRIES = { PT: 'Portugal', BR: 'Brasil', CV: 'Cabo Verde', AO: 'Angola', GW: 'Guiné-Bissau', ST: 'São Tomé e Príncipe',
  MZ: 'Moçambique', ES: 'Espanha', FR: 'França', RO: 'Roménia', UA: 'Ucrânia', MD: 'Moldávia', BG: 'Bulgária', PL: 'Polónia',
  IN: 'Índia', NP: 'Nepal', PK: 'Paquistão', BD: 'Bangladesh', MA: 'Marrocos', VE: 'Venezuela', CO: 'Colômbia', TL: 'Timor-Leste' };
const SEXES = { M: 'Masculino', F: 'Feminino' };
const MARITAL = { single: 'Solteiro(a)', married: 'Casado(a)', civil_union: 'União de facto', divorced: 'Divorciado(a)', widowed: 'Viúvo(a)' };
const EDUCATION = { basic: 'Ensino básico', secondary: 'Secundário (12.º ano)', vocational: 'Curso profissional', higher: 'Superior', other: 'Outra' };
const ID_TYPES = { citizen_card: 'Cartão de Cidadão', passport: 'Passaporte', residence_permit: 'Autorização de residência', other: 'Outro' };

async function loadWorkerProfile(id, editing) {
  const box = $('#ficha'); if (!box) return;
  const { data, error } = await sb.rpc('mini_worker_profile', { p_collab: id });
  if (!box.isConnected) return;
  if (error) { box.remove(); return; }
  const wk = data.work || {}; const p = data.personal;
  const v = (x) => (x === null || x === undefined || x === '') ? '<span class="muted">—</span>' : esc(String(x));
  const item = (label, html) => `<div><dt>${esc(label)}</dt><dd>${html}</dd></div>`;
  const opts = (map, cur, empty = '—') => `<option value="">${empty}</option>` + (Array.isArray(map) ? map.map((k) => [k, k]) : Object.entries(map))
    .map(([k, t]) => `<option value="${esc(k)}" ${k === cur ? 'selected' : ''}>${esc(t)}</option>`).join('')
    + (cur && !(Array.isArray(map) ? map.includes(cur) : map[cur]) ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : '');
  const age = p && p.birth_date ? Math.floor((Date.now() - new Date(p.birth_date + 'T12:00:00')) / 31557600000) : null;
  const farda = [['Camisola', wk.size_top], ['Calça', wk.size_bottom], ['Botas', wk.size_shoes], ['Luvas', wk.size_gloves]];
  if (!editing) {
    box.innerHTML = `<div class="fhead"><h2 style="margin:0">Ficha do colaborador</h2>
        ${data.can_edit ? '<button class="btn small ghost" id="fedit">Editar ficha</button>' : ''}</div>
      <div class="farda f4">${farda.map(([l, x]) => `<div class="${x ? '' : 'none'}"><span>${l}</span><b>${x ? esc(x) : '?'}</b></div>`).join('')}</div>
      ${farda.some(([, x]) => !x) ? '<p class="small muted">Faltam tamanhos da farda: vão ser precisos para entregar EPIs.</p>' : ''}
      <dl class="kv">${item('Telefone', wk.phone ? `<a href="tel:${esc(wk.phone.replace(/ /g, ''))}">${esc(wk.phone)}</a>` : v(null))}
        ${item('Email', v(wk.email))}${item('Profissão', v(wk.job_title))}${item('Categoria profissional', v(wk.category))}</dl>
      ${can('salarios.exportar') || can('salarios.configurar') ? '<div id="frate"></div>' : ''}
      ${canWh() ? '<div id="fwh"></div>' : ''}
      ${p ? `<h3>Dados pessoais</h3><dl class="kv">
        ${item('Morada', v([p.address, [p.postal_code, p.locality].filter(Boolean).join(' ')].filter(Boolean).join(', ')))}
        ${item('Concelho', v(p.municipality))}
        ${item('Data de nascimento', p.birth_date ? esc(fmtDate(p.birth_date)) + ` <span class="muted">(${age} anos)</span>` : v(null))}
        ${item('Naturalidade', v(p.birthplace))}${item('Nacionalidade', v(COUNTRIES[p.nationality] || p.nationality))}
        ${item('Sexo', v(SEXES[p.sex]))}${item('Estado civil', v(MARITAL[p.marital_status]))}
        ${item('Dependentes', v(p.dependents))}${item('Habilitações', v(EDUCATION[p.education]))}
        ${item('Documento', p.id_type || p.id_number ? esc([ID_TYPES[p.id_type], p.id_number].filter(Boolean).join(' nº ')) : v(null))}
        ${item('Validade do documento', p.id_expiry ? esc(fmtDate(p.id_expiry)) + (p.id_expiry < isoDay(new Date()) ? ' ' + chip('bad', 'caducado', 'x') : '') : v(null))}
        ${item('Contacto de emergência', p.emergency_name || p.emergency_phone ? esc([p.emergency_name, p.emergency_relation && `(${p.emergency_relation})`].filter(Boolean).join(' '))
          + (p.emergency_phone ? ` · <a href="tel:${esc(p.emergency_phone.replace(/ /g, ''))}">${esc(p.emergency_phone)}</a>` : '') : v(null))}
        </dl>${p.notes ? `<p class="small"><b>Observações:</b> ${esc(p.notes)}</p>` : ''}`
      : '<p class="small muted">Os dados pessoais só aparecem a quem tem a permissão «dados pessoais» (Recursos Humanos).</p>'}`;
    if ($('#fedit')) $('#fedit').onclick = () => loadWorkerProfile(id, true);
    loadWorkerRate(id); loadWorkerKit(id);
    return;
  }
  const inp = (name, label, val, extra = '') => `<div><label>${esc(label)}</label><input name="${name}" value="${esc(val ?? '')}" ${extra}></div>`;
  const sel = (name, label, map, cur) => `<div><label>${esc(label)}</label><select name="${name}">${opts(map, cur)}</select></div>`;
  box.innerHTML = `<h2 style="margin-top:0">Editar ficha</h2><form id="fform">
    <h3>Farda</h3><div class="row">${sel('size_top', 'Camisola', SIZES_TOP, wk.size_top)}${sel('size_bottom', 'Calça', SIZES_BOTTOM, wk.size_bottom)}
      ${sel('size_shoes', 'Botas (nº)', SIZES_SHOES, wk.size_shoes)}${sel('size_gloves', 'Luvas', GLOVES, wk.size_gloves)}</div>
    <h3>Trabalho</h3><div class="row">${inp('phone', 'Telefone', wk.phone, 'type="tel" inputmode="tel" maxlength="20"')}${inp('email', 'Email', wk.email, 'type="email" maxlength="120"')}</div>
    <div class="row">${inp('job_title', 'Profissão', wk.job_title, 'maxlength="80" placeholder="ex.: Serralheiro"')}${inp('category', 'Categoria profissional', wk.category, 'maxlength="40" placeholder="ex.: Oficial 1ª"')}</div>
    ${p ? `<h3>Dados pessoais</h3>
    <label>Morada</label><input name="address" value="${esc(p.address || '')}" maxlength="200">
    <div class="row">${inp('postal_code', 'Código postal', p.postal_code, 'maxlength="12" placeholder="0000-000"')}${inp('locality', 'Localidade', p.locality, 'maxlength="80"')}${inp('municipality', 'Concelho', p.municipality, 'maxlength="80"')}</div>
    <div class="row">${inp('birth_date', 'Data de nascimento', p.birth_date, 'type="date"')}${inp('birthplace', 'Naturalidade', p.birthplace, 'maxlength="80"')}${sel('nationality', 'Nacionalidade', COUNTRIES, p.nationality)}</div>
    <div class="row">${sel('sex', 'Sexo', SEXES, p.sex)}${sel('marital_status', 'Estado civil', MARITAL, p.marital_status)}${inp('dependents', 'Dependentes', p.dependents, 'type="number" min="0" max="20" inputmode="numeric"')}</div>
    <div class="row">${sel('education', 'Habilitações', EDUCATION, p.education)}</div>
    <div class="row">${sel('id_type', 'Documento', ID_TYPES, p.id_type)}${inp('id_number', 'Número do documento', p.id_number, 'maxlength="30"')}${inp('id_expiry', 'Válido até', p.id_expiry, 'type="date"')}</div>
    <h3>Contacto de emergência</h3>
    <div class="row">${inp('emergency_name', 'Nome', p.emergency_name, 'maxlength="80"')}${inp('emergency_relation', 'Parentesco', p.emergency_relation, 'maxlength="40" placeholder="ex.: Mulher, Pai"')}${inp('emergency_phone', 'Telefone', p.emergency_phone, 'type="tel" inputmode="tel" maxlength="20"')}</div>
    <label>Observações</label><textarea name="notes" maxlength="2000" rows="3">${esc(p.notes || '')}</textarea>
    ${more('Quem vê estes dados', '<p>Só quem tem a permissão «dados pessoais» (Recursos Humanos e administração). Cada alteração fica registada com quem a fez, mas os valores pessoais não ficam escritos no registo.</p>')}` : ''}
    <div class="row" style="margin-top:12px"><button type="button" class="btn ghost" id="fcancel">Cancelar</button><button class="btn">Guardar ficha</button></div></form>`;
  $('#fcancel').onclick = () => loadWorkerProfile(id);
  $('#fform').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const btn = e.target.querySelector('button:not([type])'); btn.disabled = true;
    const pick = (keys) => Object.fromEntries(keys.map((k) => [k, (f.get(k) || '').trim()]));
    const body = { work: pick(['phone', 'email', 'job_title', 'category', 'size_top', 'size_bottom', 'size_shoes']) };
    if (p) body.personal = pick(['address', 'postal_code', 'locality', 'municipality', 'birth_date', 'birthplace', 'nationality', 'sex',
      'marital_status', 'dependents', 'education', 'id_type', 'id_number', 'id_expiry', 'emergency_name', 'emergency_relation', 'emergency_phone', 'notes']);
    let { error: se } = await sb.rpc('mini_save_worker_profile', { p_collab: id, p_data: body });
    if (!se && (f.get('size_gloves') || '') !== (wk.size_gloves || '') && f.get('size_gloves')) ({ error: se } = await sb.rpc('mini_wh_sizes_save', { p_collab: id, p_sizes: { gloves: f.get('size_gloves') } }));
    btn.disabled = false;
    if (se) return toast(friendly(se));
    toast('Ficha guardada.'); loadWorkerProfile(id);
  };
}

// The hourly rate on the card: read with the salary permissions, changed only with salarios.configurar (never one's own).
// It feeds the site's team in the Dashboard de obra and the pay estimate in «As minhas horas».
async function loadWorkerRate(id) {
  const box = $('#frate'); if (!box) return;
  const { data, error } = await sb.rpc('mini_worker_rate', { p_collab: id });
  if (!box.isConnected) return;
  if (error) { box.remove(); return; }
  const n2 = (x) => x == null ? '' : Number(x).toFixed(2);
  box.innerHTML = `<h3>Valor à hora</h3><dl class="kv"><div><dt>Normal</dt><dd>${data.rate == null ? '<span class="muted">por definir</span>' : esc(euro(data.rate)) + '/h'}</dd></div>
      <div><dt>Extra</dt><dd>${data.overtime_rate == null ? '<span class="muted">pelas regras da lei</span>' : esc(euro(data.overtime_rate)) + '/h'}</dd></div></dl>
    ${data.can_edit ? `<form id="rform" class="row" style="align-items:end"><div><label>Normal (€/h)</label><input name="rate" type="number" min="0" max="500" step="0.01" inputmode="decimal" value="${n2(data.rate)}"></div>
      <div><label>Extra (€/h, opcional)</label><input name="ot" type="number" min="0" max="1000" step="0.01" inputmode="decimal" value="${n2(data.overtime_rate)}"></div>
      <div><button class="btn small">Guardar valor</button></div></form>` : ''}`;
  if ($('#rform')) $('#rform').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const num = (k) => (f.get(k) || '').trim() === '' ? null : Number(f.get(k));
    const { error: se } = await sb.rpc('mini_set_worker_rate', { p_collab: id, p_rate: num('rate'), p_overtime_rate: num('ot') });
    if (se) return toast(friendly(se));
    toast('Valor à hora guardado.'); loadWorkerRate(id);
  };
}

// Who already has this NIF? Only admin and HR can ask: the NIF is never sent to the app in lists.
async function findByNif(nif) {
  if (!nif) return null;
  const { data } = await sb.rpc('mini_find_by_nif', { p_nif: nif });
  return data && data[0] ? { id: data[0].collaborator_id, full_name: data[0].full_name } : null;
}

// The person is already registered (same NIF): open their sheet instead of a dead-end error.
function offerExisting(p) {
  const card = $('#newcard'); if (!card) return;
  let box = $('#dup'); if (!box) { box = document.createElement('div'); box.id = 'dup'; card.prepend(box); }
  box.innerHTML = `<div class="result warn">${ic('warn')}<div><b>Já existe</b>${esc(p.full_name)} já está registado com esse NIF.
    <p><button class="btn" id="opendup">Abrir a ficha de ${esc(p.full_name)}</button></p></div></div>`;
  $('#opendup').onclick = () => { state.worker = p.id; go('ficha'); };
  box.scrollIntoView({ behavior: 'smooth' });
}

// A worker without a login of his own sees his hours on the team leader's phone: he taps HIS card, the phone shows HIS
// month, read-only, no money. Each look is written down and the worker sees who looked. Closes itself after 90 s.
async function cardGlance(project) {
  const d = document.createElement('dialog'); d.className = 'dlg glance';
  let ctrl = null; let timer = null;
  const stop = () => { if (ctrl) { ctrl.abort(); ctrl = null; } clearInterval(timer); };
  d.addEventListener('close', () => { stop(); d.remove(); });
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  const ask = (msg) => {
    stop();
    d.innerHTML = `<div class="gl-ask"><h2>Ver as horas com o cartão</h2>
      ${'NDEFReader' in window ? `<div class="tapzone on"><span class="ring">${ic('tap')}</span><b>Encosta o cartão do colaborador</b><span class="small">às costas deste telemóvel</span></div>` : ''}
      ${msg ? `<div class="result bad">${ic('warn')}<div><b>${esc(msg)}</b></div></div>` : ''}
      <form class="gl-num"><label for="gluid">${'NDEFReader' in window ? 'Ou escreve o número do cartão' : 'Número do cartão (ou leitor USB)'}</label>
        <div class="row"><input id="gluid" autocomplete="off" autocapitalize="characters" placeholder="ex.: 04:A1:B2:C3"><button class="btn">Ver</button></div></form>
      <p class="small muted">${ic('shield')} Mostra só as horas e os pedidos dele, nunca valores. A consulta fica registada e ele vê quem consultou.</p>
      <button class="btn ghost wide" data-close>Fechar</button></div>`;
    d.querySelector('[data-close]').onclick = () => d.close();
    d.querySelector('form').onsubmit = (e) => { e.preventDefault(); const v = d.querySelector('#gluid').value.trim(); if (v) show(normUid(v)); };
    if ('NDEFReader' in window) {
      try {
        const c = new AbortController(); ctrl = c; const reader = new NDEFReader();
        reader.scan({ signal: c.signal }).catch((err) => toast('O NFC não arrancou: ' + err.message));
        reader.onreading = (ev) => { if (ctrl === c) show(normUid(ev.serialNumber)); };
      } catch (err) { toast('O NFC não arrancou: ' + err.message); }
    }
  };
  const show = async (uid) => {
    stop();
    const { data: g, error } = await sb.rpc('mini_card_glance', project ? { p_uid: uid, p_project: project } : { p_uid: uid });
    if (!d.isConnected) return;
    if (error) return ask(friendly(error));
    const t = g.totals || {}; const b = g.balance;
    const days = (g.days || []).slice(0, 14);
    let left = 90;
    d.innerHTML = `<div class="gl-show"><div class="gl-top">${avatar(g.name)}<div class="grow"><b>${esc(g.name)}</b><small>${esc(g.number || '')}</small></div>
        <span class="gl-left" id="glleft">90 s</span></div>
      <div class="kpis k3"><div class="kpi"><b>${esc(fmtMin(t.worked || 0))}</b><span>este mês</span></div>
        <div class="kpi info"><b>${esc(fmtMin(t.overtime || 0))}</b><span>extra</span></div>
        <div class="kpi ok"><b>${t.validated || 0}<small>/${t.rows || 0}</small></b><span>dias validados</span></div></div>
      ${b ? `<p class="small gl-vac">${ic('calendar')}<b>${b.remaining}</b> dias de férias por marcar em ${b.year}</p>` : ''}
      <h3>Últimos dias</h3>${days.length ? `<div class="gl-days">${days.map((r) => { const tz = r.tz || DEFAULT_TZ; return `<div class="gl-day">
          <span class="d">${esc(dayLabel(r.date))}</span><span class="h">${esc(fmtHour(r.first_in, tz) || '?')}–${esc(fmtHour(r.last_out, tz) || '?')}</span>
          <b>${esc(fmtMin(r.worked))}</b>${r.date === g.today && r.anomalies.every((x) => x === 'open_shift') && r.anomalies.length ? chip('info', 'a decorrer', 'clock') : r.anomalies.length ? chip('anom', 'falta picagem', 'warn') : chip(r.status === 'registered' ? 'reg' : 'val', MINE_STATE[r.status] || r.status)}</div>`; }).join('')}</div>`
        : '<p class="small muted">Sem dias registados nas últimas semanas.</p>'}
      ${(g.absences || []).length ? `<h3>Pedidos</h3>${g.absences.map((a) => `<p class="small">${esc(ABS_KIND[a.kind] || a.kind)} · ${esc(absWhen(a))} ${ABS_CHIP[a.status] || ''}</p>`).join('')}` : ''}
      ${(g.disputes || []).length ? `<h3>Reclamações</h3>${g.disputes.map((x) => `<p class="small">${esc(DISPUTE_REASON[x.reason] || x.reason)} · ${esc(dayLabel(x.day))} ${x.status === 'open' ? chip('reg', 'à espera', 'clock') : x.status === 'fixed' ? chip('val', 'corrigido', 'ok') : chip('', 'mantido')}</p>`).join('')}` : ''}
      <p class="small muted">Se um dia estiver errado, diz-me agora e eu corrijo em Horas, com o motivo.</p>
      <div class="acts"><button class="btn big" data-close>Fechar</button><button class="btn ghost wide" data-next>Outro colaborador</button></div></div>`;
    d.querySelector('[data-close]').onclick = () => d.close();
    d.querySelector('[data-next]').onclick = () => ask();
    timer = setInterval(() => { left -= 1; const el = d.querySelector('#glleft'); if (el) el.textContent = left + ' s'; if (left <= 0) d.close(); }, 1000);
  };
  document.body.appendChild(d); d.showModal(); ask();
}

async function readOneCard(sel) {
  try {
    const ctrl = new AbortController(); const reader = new NDEFReader();
    await reader.scan({ signal: ctrl.signal }); toast('Encosta o cartão ao telemóvel.');
    reader.onreading = (ev) => { app.querySelector(sel).value = normUid(ev.serialNumber); ctrl.abort(); toast('Cartão lido.'); };
    setTimeout(() => ctrl.abort(), 20000);
  } catch (err) { toast('O NFC não arrancou: ' + err.message); }
}

// ------------------------------------------------------------------ Acolhimento (the new worker's mandatory steps)
// A person whose account is not active yet sees only this: the steps in order, nothing of the app behind them.
// The database is the lock (is_fully_active); this screen only shows the way through it.
const ONB_STEPS = ['Acolhimento', 'Os meus dados', 'Contrato', 'Assinar', 'Pronto'];
const ONB_AT = { pending_video: 0, pending_data: 1, pending_hr_validation: 1, pending_contract: 2, pending_rate_approval: 3, active: 4 };
const ytId = (s) => { const m = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/.exec(String(s || '')) || /^([A-Za-z0-9_-]{11})$/.exec(String(s || '').trim());
  return m ? m[1] : null; };
const paras = (t) => String(t || '').split(/\n\s*\n/).map((x) => `<p>${esc(x.trim()).replace(/\n/g, '<br>')}</p>`).join('');
const KIND_IC = { video: 'play', document: 'doc', bot: 'bot', hunt: 'search' };
const KIND_TX = { video: 'Vídeo', document: 'Para ler', bot: 'Conversa com o bot', hunt: 'Encontra o perigo' };
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
function onbShell(ob, inner) {
  dropRobots();
  state.onb = ob; nav.hidden = true; signedOut(false); document.body.classList.add('onboarding');
  const at = ONB_AT[ob.status] ?? 0;
  app.innerHTML = `<div class="onb">
    <div class="onb-top"><span class="onb-logo">${LOGO('lgO')}<b>GestNow</b></span><span class="grow"></span><button class="btn ghost small" id="onbout">${ic('out')}Sair</button></div>
    <div class="onb-hello"><p class="ph-k">${esc(ob.company || '')}</p><h1>Bem-vindo, ${esc(String(ob.name || '').split(' ')[0])}</h1>
      <p class="muted">Antes de começares a trabalhar connosco, há ${ONB_STEPS.length - 1} passos. Cada um abre quando o anterior estiver feito.</p></div>
    <ol class="onb-steps">${ONB_STEPS.map((s, i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}"><span>${i < at ? ic('ok') : i + 1}</span><b>${esc(s)}</b></li>`).join('')}</ol>
    <div id="onbbody">${inner}</div></div>`;
  $('#onbout').onclick = () => { document.body.classList.remove('onboarding'); signOut(); };
}
async function showOnboarding(ob) {
  if (!ob) { const r = await sb.rpc('mini_onboarding'); if (r.error) return showMessage('Sem ligação', friendly(r.error), true); ob = r.data; }
  Voice.stop();
  if (!ob || ob.status === 'active' || ob.status === 'none') { if (state.onb && ob && ob.status === 'active') state.tourNext = true; state.onb = null; document.body.classList.remove('onboarding'); return boot(); }
  ob.skew = new Date(ob.server_now).getTime() - Date.now();
  if (ob.status !== 'pending_video') {
    const waiting = { pending_data: ['Os teus dados', 'O próximo passo é preencheres a tua ficha: morada, NISS, IBAN e documentos. Este ecrã ainda está a ser preparado; até lá, o RH trata disto contigo.'],
      pending_hr_validation: ['À espera do RH', 'O RH está a confirmar os teus dados. Avisamos-te aqui quando estiver.'],
      pending_contract: ['À espera do contrato', 'O RH está a preparar o teu contrato. Quando chegar, aparece aqui para leres e assinares.'],
      pending_rate_approval: ['Quase pronto', 'Falta confirmares as condições do contrato.'] }[ob.status] || ['Em curso', ''];
    return onbShell(ob, `<div class="card onb-wait">${ic('clock')}<h2>${esc(waiting[0])}</h2><p>${esc(waiting[1])}</p>
      <p class="small muted">${ic('ok')} Acolhimento concluído${ob.steps && ob.steps.safety_videos ? ' em ' + esc(new Date(ob.steps.safety_videos).toLocaleDateString('pt-PT')) : ''}.</p>
      <button class="btn ghost" id="onbre">Atualizar</button></div>`), ($('#onbre').onclick = () => showOnboarding());
  }
  const items = ob.items || [];
  const done = items.filter((x) => x.passed_at).length;
  const cur = items.find((x) => !x.passed_at);
  onbShell(ob, items.length ? `<div class="card onb-list"><div class="sec-h" style="margin-top:0"><h2>Passo 1 · Acolhimento</h2><span class="count">${done}/${items.length}</span></div>
      <div class="onb-bar"><i style="width:${Math.round(100 * done / items.length)}%"></i></div>
      <p class="small muted">Vê ou lê cada parte até ao fim. No fim respondes a umas perguntas rápidas. Se errares, vês outra vez.</p>
      ${items.map((x, i) => { const st = x.passed_at ? 'done' : x === cur ? 'now' : 'lock'; return `<button class="onb-item ${st}" ${st === 'now' ? `data-open="${esc(x.id)}"` : 'disabled'}>
        <span class="oi">${st === 'done' ? ic('ok') : st === 'lock' ? ic('lock') : ic(KIND_IC[x.kind] || 'doc')}</span>
        <span class="grow"><b>${i + 1}. ${esc(x.title)}</b><small>${KIND_TX[x.kind] || 'Para ler'} · ${Math.max(1, Math.round(x.min_seconds / 60))} min${x.questions.length ? ` · ${pl(x.questions.length, 'pergunta', 'perguntas')}` : ''}${x.attempts && !x.passed_at ? ` · ${x.attempts}ª tentativa falhada` : ''}</small></span>
        ${st === 'now' ? `<span class="btn small">${x.opened_at ? 'Continuar' : 'Começar'}</span>` : st === 'done' ? chip('val', 'feito', 'ok') : ''}</button>`; }).join('')}</div>`
    : `<div class="card onb-wait">${ic('clock')}<h2>O acolhimento ainda está a ser preparado</h2><p>A empresa ainda não pôs os vídeos e manuais. Volta daqui a pouco.</p><button class="btn ghost" id="onbre">Atualizar</button></div>`);
  if ($('#onbre')) $('#onbre').onclick = () => showOnboarding();
  app.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => onbItem(items.find((x) => x.id === b.dataset.open), items));
}
// One video or manual: the clock is the server's; «Já vi» opens when the time is up (and, for a manual, at its end).
async function onbItem(x, items) {
  if (x.kind === 'bot') return onbBot(x, items);
  if (x.kind === 'hunt') return onbHunt(x, items);
  const { data: openedAt, error } = await sb.rpc('mini_induction_open', { p_item: x.id });
  if (error) return toast(friendly(error));
  const ob = state.onb; const n = items.indexOf(x) + 1;
  const end = new Date(openedAt).getTime() + x.min_seconds * 900 - (ob.skew || 0);
  onbShell(ob, `<div class="card onb-view"><p class="eyebrow" style="margin-top:0">Parte ${n} de ${items.length}</p><h2>${esc(x.title)}</h2>
    ${x.kind === 'video' ? `<div class="onb-video"><iframe src="https://www.youtube-nocookie.com/embed/${esc(x.video_id)}?rel=0&modestbranding=1&playsinline=1" title="${esc(x.title)}"
        allow="encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`
      : `<div class="onb-manual" id="onbman">${paras(x.body)}</div>`}
    <div class="onb-go"><button class="btn big" id="seen" disabled>${ic('clock')}<span id="seentx">…</span></button>
      <button class="btn ghost wide" id="back">Voltar à lista</button></div></div>`);
  // A manual counts as read when its last line has been on the screen: the box scrolled to its end, and its bottom in view.
  let read = x.kind === 'video';
  const atEnd = () => { const m = $('#onbman'); if (!m) return false; const r = m.getBoundingClientRect();
    return m.scrollTop + m.clientHeight >= m.scrollHeight - 8 && r.bottom <= window.innerHeight + 4; };
  const tick = () => {
    const b = $('#seen'); if (!b) return clearInterval(t);
    if (!read && atEnd()) read = true;
    const left = Math.ceil((end - Date.now()) / 1000);
    b.disabled = left > 0 || !read;
    $('#seentx').textContent = left > 0 ? `Podes continuar daqui a ${mmss(left)}` : !read ? 'Lê até ao fim para continuar' : x.questions.length ? 'Já vi: responder às perguntas' : 'Já vi: continuar';
  };
  const t = setInterval(tick, 1000); tick();
  if ($('#onbman')) { $('#onbman').addEventListener('scroll', tick, { passive: true }); window.addEventListener('scroll', tick, { passive: true }); }
  $('#back').onclick = () => { clearInterval(t); window.removeEventListener('scroll', tick); showOnboarding(); };
  $('#seen').onclick = async () => {
    const { data: r, error: e } = await sb.rpc('mini_induction_seen', { p_item: x.id });
    if (e) return toast(friendly(e));
    clearInterval(t); window.removeEventListener('scroll', tick);
    if (r.step_done) { toast('Acolhimento concluído. Obrigado!'); return showOnboarding(); }
    if (!x.questions.length) return showOnboarding();
    onbQuiz(x, n, items.length);
  };
}
function onbQuiz(x, n, total, wrong) {
  onbShell(state.onb, `<form class="card onb-quiz" id="qz"><p class="eyebrow" style="margin-top:0">Parte ${n} de ${total} · perguntas</p><h2>${esc(x.title)}</h2>
    ${x.questions.map((q, i) => `<fieldset><legend>${i + 1}. ${esc(q.q)}</legend>${q.options.map((o, j) =>
      `<label class="opt"><input type="radio" name="q${i}" value="${j}" required><span>${esc(o)}</span></label>`).join('')}</fieldset>`).join('')}
    <button class="btn big">Enviar respostas</button></form>`);
  $('#qz').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const answers = x.questions.map((_, i) => Number(f.get('q' + i)));
    const { data: r, error } = await sb.rpc('mini_induction_answer', { p_item: x.id, p_answers: answers });
    if (error) return toast(friendly(error));
    if (r.passed) { toast(r.step_done ? 'Acolhimento concluído. Obrigado!' : 'Muito bem! Passa à parte seguinte.'); return showOnboarding(); }
    const bad = (r.wrong || []).map((i) => i + 1);
    onbShell(state.onb, `<div class="card onb-wait bad">${ic('warn')}<h2>Ainda não</h2>
      <p>Erraste ${bad.length === 1 ? 'a pergunta ' + bad[0] : 'as perguntas ' + bad.join(' e ')}. Vê outra vez com atenção e responde de novo.</p>
      <button class="btn big" id="again">Ver outra vez</button></div>`);
    $('#again').onclick = async () => { const r2 = await sb.rpc('mini_onboarding'); if (r2.error) return toast(friendly(r2.error)); r2.data.skew = new Date(r2.data.server_now).getTime() - Date.now(); state.onb = r2.data;
      const items = r2.data.items; onbItem(items.find((y) => y.id === x.id), items); };
  };
}

// HR / safety: the videos and manuals of the onboarding, in order, each with its questions; and who is in onboarding now.
async function viewInduction() {
  if (!can('acolhimento.gerir')) return go('trabalhadores');
  app.innerHTML = `<div class="ph"><div><p class="ph-k">Pessoas</p><h1>Acolhimento</h1></div><button class="btn" id="addi">+ Nova parte</button></div>
    <p class="muted lead">O que cada pessoa nova ouve, vê e lê no telemóvel antes de começar. Mudar uma conversa, um vídeo, um texto ou as perguntas cria uma versão nova; a prova diz sempre que versão cada pessoa fez.</p>
    <div id="ibot"></div><div class="ind-grid"><div id="ilist">${skel(3)}</div><div id="iboard"></div></div>`;
  $('#addi').onclick = () => editInduction(null);
  loadBotCard(); loadInduction(); loadOnbBoard('#iboard');
}
async function loadInduction() {
  const el = $('#ilist'); if (!el) return;
  const { data, error } = await sb.rpc('mini_induction_items');
  if (!el.isConnected) return;
  if (error) { el.innerHTML = `<p>${esc(friendly(error))}</p>`; return; }
  state.indItems = data;
  if (!data.length) {
    el.innerHTML = `<div class="card">${empty('play', 'Ainda não há acolhimento', 'Começa pelo pacote geral da GestNow (9 conversas de segurança com o bot e o jogo «Encontra o perigo») e junta por cima o que é só da tua empresa: regras da obra, manuais do cliente, vídeos.')}
      <p><button class="btn wide" id="tpl">Usar o pacote geral da GestNow (10 partes)</button></p></div>`;
    $('#tpl').onclick = useInductionTemplate; return;
  }
  el.innerHTML = `<div class="card ind-list">${data.map((x, i) => `<button class="ind ${x.is_active ? '' : 'off'}" data-id="${esc(x.id)}">
      <span class="oi">${ic(KIND_IC[x.kind] || 'doc')}</span><span class="grow"><b>${i + 1}. ${esc(x.title)}</b>
      <small>${x.kind === 'document' ? 'Manual' : KIND_TX[x.kind]} · mín. ${mmss(x.min_seconds)} · ${pl(x.questions.length, 'pergunta', 'perguntas')} · versão ${x.version}${x.for_external ? '' : ' · só da empresa'} · ${x.passed === 1 ? '1 pessoa concluiu' : `${x.passed} pessoas concluíram`}</small></span>
      ${x.is_active ? chip('val', 'ativo', 'ok') : chip('', 'desligado')}</button>`).join('')}</div>
    <p class="small muted">Toca para mudar. Quem já é ativo não precisa de rever; uma versão nova vale para quem entrar a partir de agora.</p>
    ${INDUCTION_TEMPLATE.some((t) => !data.some((x) => x.title === t.title)) ? `<p><button class="btn ghost wide" id="tpl">${ic('bot')}Juntar o que falta do pacote geral da GestNow</button></p>` : ''}`;
  if ($('#tpl')) $('#tpl').onclick = useInductionTemplate;
  el.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => editInduction(data.find((x) => x.id === b.dataset.id)));
}
const ONB_LABEL = { pending_video: 'Passo 1 · acolhimento', pending_data: 'Passo 2 · dados', pending_hr_validation: 'Passo 2 · à espera do RH',
  pending_contract: 'Passo 3 · contrato', pending_rate_approval: 'Passo 4 · assinar' };
async function loadOnbBoard(sel, onlyIfAny) {
  const el = $(sel); if (!el) return;
  const { data, error } = await sb.rpc('mini_onboarding_board');
  if (!el.isConnected || error || (onlyIfAny && !data.length)) return;
  el.innerHTML = `<div class="card"><div class="sec-h" style="margin-top:0"><h2>Novas entradas</h2>${data.length ? `<span class="count">${data.length}</span>` : ''}</div>
    ${data.length ? data.map((p) => `<button class="onb-row" data-id="${esc(p.id)}">${avatar(p.name)}
      <span class="grow"><b>${esc(p.name)}</b><small>${esc(ONB_LABEL[p.status] || p.status)}${p.status === 'pending_video' && p.items ? ` · ${p.passed}/${p.items} partes` : ''}${p.has_login ? '' : ' · ainda sem conta na app'}</small></span>
      ${p.status === 'pending_video' && p.items ? `<span class="mini-bar"><i style="width:${Math.round(100 * p.passed / p.items)}%"></i></span>` : ''}</button>`).join('')
      : `<p class="small muted">${ic('ok')} Ninguém a meio do acolhimento. Ao registar uma pessoa nova em Pessoas, escolhe «Faz o acolhimento na app».</p>`}</div>`;
  el.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => { state.worker = b.dataset.id; go('ficha'); });
}
async function editInduction(x) {
  const q = (x && x.questions) || [];
  const scenes = ((await sb.rpc('mini_hunt_scenes')).data) || [];
  const qrow = (i, v) => `<fieldset class="qedit" data-q="${i}"><legend>Pergunta ${i + 1}</legend><input name="q${i}" value="${esc(v ? v.q : '')}" placeholder="ex.: Sem capacete podes entrar na obra?" maxlength="200">
    ${[0, 1, 2].map((j) => `<label class="opt"><input type="radio" name="c${i}" value="${j}" ${v && v.correct === j ? 'checked' : !v && j === 0 ? 'checked' : ''} title="Resposta certa">
      <input name="o${i}_${j}" value="${esc(v && v.options[j] ? v.options[j] : '')}" placeholder="${j === 0 ? 'Resposta' : 'Outra resposta'}${j === 2 ? ' (opcional)' : ''}" maxlength="120"></label>`).join('')}</fieldset>`;
  const fd = await askSheet(x ? 'Mudar: ' + x.title : 'Nova parte do acolhimento', `
    <label for="it">Título</label><input id="it" name="title" required minlength="3" maxlength="120" value="${esc(x ? x.title : '')}" placeholder="ex.: Regras de segurança da refinaria">
    <div class="chips reasons" role="radiogroup"><label class="chip"><input type="radio" name="kind" value="bot" ${!x || x.kind === 'bot' ? 'checked' : ''}>Conversa com o bot</label>
      <label class="chip"><input type="radio" name="kind" value="video" ${x && x.kind === 'video' ? 'checked' : ''}>Vídeo do YouTube</label>
      <label class="chip"><input type="radio" name="kind" value="document" ${x && x.kind === 'document' ? 'checked' : ''}>Texto para ler</label>
      ${scenes.length ? `<label class="chip"><input type="radio" name="kind" value="hunt" ${x && x.kind === 'hunt' ? 'checked' : ''}>Encontra o perigo</label>` : ''}</div>
    <div id="kh" hidden><label for="isc">Imagem</label><select id="isc" name="scene">${scenes.map((c) => `<option value="${esc(c.key)}" ${x && x.scene === c.key ? 'selected' : ''}>${esc(c.title)} · ${c.hazards} perigos</option>`).join('')}</select>
      <img class="hunt-prev" id="iscp" alt="" src="scenes/${esc(x && x.scene ? x.scene : (scenes[0] || {}).key)}.svg">
      <p class="small muted">A pessoa toca em cada perigo. Onde estão fica só no servidor; tocar ao calhas não passa (10 enganos e começa de novo).</p></div>
    <div id="kv"><label for="iv">Link do YouTube</label><input id="iv" name="video" value="${esc(x && x.video_id ? 'https://youtu.be/' + x.video_id : '')}" placeholder="https://youtu.be/…">
      <p class="small muted">Põe o vídeo no YouTube como «Não listado»: só quem tem o link o vê.</p></div>
    <div id="kd" hidden><label for="ib" id="ibl">Texto (uma linha em branco separa parágrafos)</label>
      <p class="small muted" id="ibh" hidden>Uma linha em branco separa cada fala do bot. Frases curtas, como se falasses com a pessoa. Toca num sinal para o pôr na fala:</p>
      <div class="picto-pick" id="ibp" hidden>${Object.entries(PICTO).map(([k, v]) => `<button type="button" class="chip" data-tag="${k}" title="Põe [${k}] no texto">${esc(v[0])}</button>`).join('')}</div>
      <textarea id="ib" name="body" rows="9" maxlength="20000">${esc(x && x.body ? x.body : '')}</textarea></div>
    <div id="km"><label for="im">Tempo mínimo antes de poder continuar (minutos)</label><input id="im" name="min" type="number" min="0.5" max="60" step="0.5" value="${x ? x.min_seconds / 60 : 2}">
    <p class="small muted">Para um vídeo, põe a duração dele. A pessoa só avança depois deste tempo.</p></div>
    <h3>Perguntas (marca a resposta certa)</h3>${[0, 1, 2].map((i) => qrow(i, q[i])).join('')}
    <label class="check inline"><input type="checkbox" name="ext" ${!x || x.for_external ? 'checked' : ''}> Também para trabalhadores de subempreiteiros</label>
    ${x ? `<label class="check inline"><input type="checkbox" name="active" ${x.is_active ? 'checked' : ''}> Ativo (desliga para deixar de mostrar a quem entra)</label>` : ''}`, 'Guardar', (dlg) => {
    const sync = () => { const v = dlg.querySelector('input[name=kind]:checked').value; dlg.querySelector('#kv').hidden = v !== 'video'; dlg.querySelector('#kd').hidden = v === 'video';
      dlg.querySelector('#km').hidden = v === 'bot' || v === 'hunt'; dlg.querySelector('#ibp').hidden = dlg.querySelector('#ibh').hidden = v !== 'bot';
      dlg.querySelector('#kh').hidden = v !== 'hunt';
      dlg.querySelector('#ibl').textContent = v === 'bot' ? 'O que o bot diz' : v === 'hunt' ? 'O que o bot diz antes de começar' : 'Texto (uma linha em branco separa parágrafos)'; };
    const sc = dlg.querySelector('#isc'); if (sc) sc.onchange = () => { dlg.querySelector('#iscp').src = `scenes/${sc.value}.svg`; };
    dlg.querySelectorAll('input[name=kind]').forEach((r) => r.onchange = sync); sync();
    const ta = dlg.querySelector('#ib');
    dlg.querySelectorAll('[data-tag]').forEach((b) => b.onclick = () => { const at = ta.selectionStart ?? ta.value.length; const t = `[${b.dataset.tag}] `;
      ta.value = ta.value.slice(0, at) + t + ta.value.slice(ta.selectionEnd ?? at); ta.focus(); ta.selectionStart = ta.selectionEnd = at + t.length; });
  });
  if (!fd) return;
  const kind = fd.get('kind');
  const questions = [0, 1, 2].map((i) => {
    const text = String(fd.get('q' + i) || '').trim(); const opts = [0, 1, 2].map((j) => String(fd.get(`o${i}_${j}`) || '').trim());
    const c = Number(fd.get('c' + i) || 0);
    if (!text) return null;
    const kept = opts.map((o, j) => ({ o, j })).filter((y) => y.o);
    return { q: text, options: kept.map((y) => y.o), correct: Math.max(0, kept.findIndex((y) => y.j === c)) };
  }).filter(Boolean);
  if (questions.some((y) => y.options.length < 2)) return toast('Cada pergunta precisa de pelo menos 2 respostas.');
  const vid = kind === 'video' ? ytId(fd.get('video')) : kind === 'hunt' ? String(fd.get('scene') || '') : null;
  if (kind === 'video' && !vid) return toast('Esse link não é de um vídeo do YouTube.');
  if (kind !== 'video' && String(fd.get('body') || '').trim().length < 20) return toast(kind === 'bot' || kind === 'hunt' ? 'Escreve o que o bot diz.' : 'Escreve o texto.');
  const { data: id, error } = await sb.rpc('mini_induction_save', { p_id: x ? x.id : null, p_title: String(fd.get('title')).trim(), p_kind: kind,
    p_video_id: vid, p_body: kind !== 'video' ? String(fd.get('body') || '') : null, p_min_seconds: kind === 'bot' || kind === 'hunt' ? null : Math.round(Number(fd.get('min') || 1) * 60),
    p_questions: questions, p_position: x ? x.position : null, p_for_external: !!fd.get('ext') });
  if (error) return toast(friendly(error));
  if (x && !!fd.get('active') !== x.is_active) { const r = await sb.rpc('mini_induction_set_active', { p_id: id, p_active: !!fd.get('active') }); if (r.error) return toast(friendly(r.error)); }
  toast('Guardado.'); loadInduction();
}
// The GestNow general pack: the same for every client company, which then adds its own (rules of the site, the client's manuals).
// Written by GestNow from the general rules of prevention (ACT, EU-OSHA, OSHA): no one's manual is copied. Plain words, short lines.
// Every part is a conversation with the bot; [sinais] show the safety sign. Questions: the right answer is «correct».
const INDUCTION_TEMPLATE = [
  { title: 'Bem-vindo: como trabalhamos', kind: 'bot', body: `Bem-vindo à equipa! Vou explicar-te as regras que valem em todas as obras. Presta atenção, porque no fim faço-te umas perguntas.

[cartao] Picar o ponto: à chegada e à saída, encostas o teu cartão no leitor da obra.

Se te esqueceres de picar, avisa logo o encarregado. Ele regista a picagem com o motivo.

Nunca piques por um colega, e nunca emprestes o teu cartão.

O encarregado diz-te o horário da obra. Se precisares de faltar ou de sair mais cedo, faz o pedido na app, com antecedência.

Na app vês todas as tuas horas. Se um dia estiver errado, carrega em «Não concordo com este dia», antes do fim do mês.`,
    q: [{ q: 'Esqueceste-te de picar a saída. O que fazes?', options: ['Aviso o encarregado', 'Peço a um colega para picar por mim', 'Não faço nada'], correct: 0 },
      { q: 'Podes emprestar o teu cartão a um colega?', options: ['Sim, se for amigo', 'Nunca'], correct: 1 }] },
  { title: 'Equipamento de proteção individual (EPI)', kind: 'bot', body: `Agora, o mais importante: o teu equipamento de proteção.

[capacete] [botas] [colete] Na obra usas sempre capacete, botas de biqueira de aço e colete refletor.

[oculos] [luvas] Também óculos de proteção, e as luvas certas para a tarefa que estás a fazer.

[auditiva] [arnes] Algumas zonas pedem mais: proteção auditiva, máscara ou arnês. Segue a sinalização e o que o encarregado disser.

Sem o equipamento completo, não entras na obra. Se alguma coisa estiver estragada ou perdida, pede outra antes de começar a trabalhar.`,
    q: [{ q: 'Sem capacete podes entrar na obra?', options: ['Sim, se for rápido', 'Não'], correct: 1 },
      { q: 'As tuas luvas rasgaram-se. O que fazes?', options: ['Trabalho sem luvas', 'Peço luvas novas antes de continuar'], correct: 1 }] },
  { title: 'Autorização de trabalho e direito de parar', kind: 'bot', body: `Nas fábricas e refinarias, quase todos os trabalhos precisam de uma autorização de trabalho, assinada antes de começar.

[autorizacao] A autorização diz o que vais fazer, onde, os perigos e as proteções. Lê-a, ou pede que ta expliquem, antes de assinares.

Só fazes o que está escrito na autorização. Se o trabalho mudar, para e pede uma autorização nova.

[stop] Tens sempre o direito, e o dever, de parar um trabalho que não é seguro. Ninguém te pode castigar por isso.

Se vires um perigo, para, afasta as pessoas, e avisa o encarregado. Primeiro a segurança, depois o trabalho.`,
    q: [{ q: 'O trabalho mudou e já não é o que está na autorização. O que fazes?', options: ['Continuo, é quase igual', 'Paro e peço uma autorização nova'], correct: 1 },
      { q: 'Achas que um trabalho não é seguro. Podes pará-lo?', options: ['Sim, e devo avisar o encarregado', 'Não, só o chefe pode parar'], correct: 0 }] },
  { title: 'Trabalhos em altura', kind: 'bot', body: `As quedas em altura são das maiores causas de mortes nas obras. Vamos falar disso.

[queda] Onde há risco de cair, tem de haver proteção: guarda-corpos, redes, ou arnês preso a um ponto seguro.

[arnes] Se usas arnês, está sempre preso. Um arnês solto não te protege de nada.

[andaime] Só sobes a um andaime com a etiqueta verde, verificado. Etiqueta vermelha, ou sem etiqueta: não sobes.

Nunca tires um guarda-corpos, uma tampa ou uma rede. Se for preciso, quem monta o andaime faz a alteração.

Ferramentas em altura vão presas, para não caírem em cima de ninguém. E por baixo, a zona fica vedada.`,
    q: [{ q: 'O andaime tem a etiqueta vermelha. Podes subir?', options: ['Não', 'Sim, se for só um minuto'], correct: 0 },
      { q: 'Estás em altura com arnês. Quando o prendes?', options: ['Só nas zonas mais altas', 'Sempre'], correct: 1 },
      { q: 'Um guarda-corpos atrapalha o teu trabalho. O que fazes?', options: ['Tiro-o e volto a pôr no fim', 'Peço a quem montou para o alterar'], correct: 1 }] },
  { title: 'Espaços confinados', kind: 'bot', body: `Um espaço confinado é um sítio fechado com entrada apertada: um tanque, uma cisterna, uma caixa de visita, o interior de um equipamento.

[gas] O ar lá dentro pode não ter oxigénio suficiente, ou ter gases tóxicos ou que explodem. Muitas vezes não se vê nem se cheira.

[autorizacao] Só entras com autorização de trabalho, e depois de o ar ser medido. As medições continuam enquanto lá estás.

Fica sempre um vigilante cá fora, a falar contigo, com o plano de salvamento pronto.

Se um colega desmaiar lá dentro, não entres para o tirar. Dá o alarme. A maior parte das vítimas destes acidentes são pessoas que entraram para salvar.`,
    q: [{ q: 'Um colega desmaiou dentro de um tanque. O que fazes?', options: ['Entro logo para o tirar', 'Dou o alarme e não entro sem equipamento'], correct: 1 },
      { q: 'Quando podes entrar num espaço confinado?', options: ['Com autorização e o ar medido', 'Quando não cheira a nada'], correct: 0 }] },
  { title: 'Produtos químicos', kind: 'bot', body: `Na indústria trabalhas perto de produtos químicos. Alguns queimam, outros são tóxicos, outros pegam fogo.

[quimico] Lê sempre o rótulo. Os símbolos de perigo, em losango vermelho, dizem-te o risco.

A ficha de dados de segurança explica como usar, que proteção usar, e o que fazer num acidente. Pergunta ao encarregado onde está.

[luvas] [oculos] Usa as luvas e os óculos certos para aquele produto. Nunca uses um produto numa embalagem sem rótulo.

[fumar] Nunca comas, bebas ou fumes onde há produtos químicos. Lava as mãos antes das pausas.

Se um produto te salpicar os olhos ou a pele, lava logo com muita água, e avisa.`,
    q: [{ q: 'Encontraste uma garrafa sem rótulo. O que fazes?', options: ['Uso, deve ser água', 'Não uso e aviso o encarregado'], correct: 1 },
      { q: 'Um produto salpicou-te os olhos. O que fazes primeiro?', options: ['Lavo logo com muita água', 'Espero para ver se passa'], correct: 0 }] },
  { title: 'Trabalho a quente e incêndio', kind: 'bot', body: `Soldar, cortar ou rebarbar faz faíscas. Numa zona com gases ou combustíveis, uma faísca chega para um incêndio ou uma explosão.

[inflamavel] [autorizacao] Trabalho a quente só com autorização, e depois de medir os gases à volta.

[extintor] Tem sempre um extintor ao teu lado, e tira ou tapa tudo o que possa arder.

Quando acabas, a zona fica vigiada durante algum tempo. Muitos incêndios começam depois de o trabalho acabar.

[alarme] Se houver um início de incêndio, dá o alarme primeiro. Só usas o extintor se for pequeno e tiveres uma saída atrás de ti.`,
    q: [{ q: 'Antes de soldar perto de tubagens com produto, o que é preciso?', options: ['Nada, sou soldador experiente', 'Autorização e medição de gases'], correct: 1 },
      { q: 'Acabaste de soldar. A zona pode ficar sozinha logo?', options: ['Não, fica vigiada durante algum tempo', 'Sim'], correct: 0 }] },
  { title: 'Bloqueio de energias (consignação)', kind: 'bot', body: `Antes de mexer numa máquina, numa bomba ou num quadro elétrico, a energia tem de estar desligada e bloqueada. Chama-se consignação.

[cadeado] Cada pessoa que trabalha no equipamento põe o seu próprio cadeado e a sua etiqueta. A chave fica contigo.

Depois de bloquear, confirma que não há energia: tenta arrancar, mede a tensão, verifica a pressão.

Nunca tires o cadeado de outra pessoa. E nunca trabalhes num equipamento só porque «disseram que está desligado».

[stop] Se encontrares um cadeado ou uma etiqueta, não mexas. Pergunta de quem é.`,
    q: [{ q: 'Vais trabalhar numa bomba. Basta alguém dizer que está desligada?', options: ['Sim', 'Não: ponho o meu cadeado e confirmo'], correct: 1 },
      { q: 'Podes tirar o cadeado de um colega que já foi embora?', options: ['Nunca', 'Sim, se ele demorar'], correct: 0 }] },
  { title: 'Emergências e quase-acidentes', kind: 'bot', body: `Para terminar: o que fazer quando alguma coisa corre mal.

[alarme] [saida] Se tocar o alarme, para o trabalho, deixa a zona em segurança se puderes, e sai pelo caminho de evacuação.

[encontro] Vai para o ponto de encontro e espera pelo encarregado, para seres contado. Não voltes atrás para buscar nada.

[112] [socorro] Se houver um acidente: protege-te primeiro, chama ajuda, 112 e o encarregado, e não mexas no ferido se não souberes como.

Um quase-acidente é quando quase acontece. Conta sempre ao encarregado, no mesmo dia. Falar disso evita o próximo acidente.

Obrigado por me ouvires. Bom trabalho, e em segurança!`,
    q: [{ q: 'Toca o alarme. Para onde vais?', options: ['Para o ponto de encontro', 'Volto à carrinha buscar as minhas coisas', 'Continuo a trabalhar'], correct: 0 },
      { q: 'Quase caiu uma peça em cima de um colega, mas ninguém se magoou. O que fazes?', options: ['Nada, não aconteceu nada', 'Conto ao encarregado no mesmo dia'], correct: 1 }] },
  // The last part is a game: tap the hazards in a picture (sql/58). Where they are is only on the server.
  { title: 'Encontra o perigo: a refinaria', kind: 'hunt', scene: 'obra-1',
    body: 'Agora és tu. Nesta zona de trabalho há sete perigos. Toca em cada um. Olha bem antes de tocar: muitos toques ao calhas e começas de novo.', q: [] }];
// Adds the parts of the general pack this company does not have yet (by title), at the end, in the pack's order.
async function useInductionTemplate() {
  const have = new Set((state.indItems || []).map((x) => x.title));
  const add = INDUCTION_TEMPLATE.filter((t) => !have.has(t.title));
  if (!add.length) return toast('Já tens o pacote geral completo.');
  const base = Math.max(0, ...(state.indItems || []).map((x) => x.position));
  for (const [i, t] of add.entries()) {
    const { error } = await sb.rpc('mini_induction_save', { p_id: null, p_title: t.title, p_kind: t.kind, p_video_id: t.scene || null, p_body: t.body,
      p_min_seconds: t.min || null, p_questions: t.q, p_position: base + (i + 1) * 10, p_for_external: true });
    if (error) return toast(friendly(error));
  }
  toast(`${add.length === 1 ? '1 parte do pacote geral junta' : `${add.length} partes do pacote geral juntas`}. Revê o que o bot diz e junta o que é só da tua empresa.`); loadInduction();
}

// ------------------------------------------------------------------ O bot de segurança (acolhimento em conversa, visita guiada)
// A scripted bot, never a free AI: everyone hears the same words, and the proof says which (sql/56).
// One paragraph = one thing the bot says. [capacete], [saida]… show a safety sign. The phone's own voice speaks it.
const BOT_LOOKS = { robo: 'Robô de segurança', capacete: 'Capacete amarelo', ela: 'Técnica de segurança', ele: 'Técnico de segurança' };
function botFace(look, cls) {
  if (look === 'robo' || !BOT_LOOKS[look]) return `<svg class="botface ${cls || ''}" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="#e0e7ff"/>
    <path d="M24 55h16v9H24z" fill="#1e293b"/><path d="M14 64c1-8 7-11 18-11s17 3 18 11z" fill="#1d4ed8"/><path d="M22 54l10 7 10-7" fill="none" stroke="#facc15" stroke-width="3"/>
    <rect x="17.5" y="29" width="29" height="25" rx="12.5" fill="#f1f5f9" stroke="#cbd5e1"/><rect x="15" y="37" width="4" height="9" rx="2" fill="#1d4ed8"/><rect x="45" y="37" width="4" height="9" rx="2" fill="#1d4ed8"/>
    <rect x="21.5" y="34.5" width="21" height="10" rx="5" fill="#0f172a"/>
    <circle cx="27" cy="39.5" r="2.4" fill="#67e8f9"/><circle cx="37" cy="39.5" r="2.4" fill="#67e8f9"/><circle cx="27" cy="39.5" r="4" fill="#22d3ee" opacity=".25"/><circle cx="37" cy="39.5" r="4" fill="#22d3ee" opacity=".25"/>
    <ellipse class="mouth" cx="32" cy="49" rx="3.4" ry="1.1" fill="#475569"/>
    <path d="M14.5 32a17.5 17.5 0 0 1 35 0z" fill="#facc15" stroke="#eab308" stroke-width="1.2"/><path d="M29.5 15h5v16h-5z" fill="#eab308" opacity=".6"/>
    <rect x="10.5" y="30" width="43" height="5" rx="2.5" fill="#eab308"/></svg>`;
  const helmet = look === 'capacete' ? '#f59e0b' : '#f8fafc'; const brim = look === 'capacete' ? '#d97706' : '#cbd5e1';
  return `<svg class="botface ${cls || ''}" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="#e0e7ff"/>
    ${look === 'ela' ? '<path d="M16.5 40c0 12 4 17 9 18h13c5-1 9-6 9-18z" fill="#7c2d12"/>' : ''}
    <circle cx="32" cy="42" r="14.5" fill="#fcd9b6"/>
    ${look === 'ele' ? '<path d="M18.5 44c1 9 6 13.5 13.5 13.5S44.5 53 45.5 44c-3 4-7.5 5.5-13.5 5.5S21.5 48 18.5 44z" fill="#57534e"/>' : ''}
    <circle cx="26.5" cy="41" r="2" fill="#1f2937"/><circle cx="37.5" cy="41" r="2" fill="#1f2937"/>
    <ellipse class="mouth" cx="32" cy="48.3" rx="3.6" ry="1.5" fill="#9f1239"/>
    <path d="M15 37.5a17 17 0 0 1 34 0z" fill="${helmet}" stroke="${brim}" stroke-width="1.2"/><path d="M29.5 21.5h5v15h-5z" fill="${brim}" opacity=".55"/>
    <rect x="10.5" y="35.5" width="43" height="5" rx="2.5" fill="${brim}"/></svg>`;
}
// Safety signs, drawn here (no files, no network): blue = mandatory, green = safe way, red = fire / prohibited.
const PICTO = {
  capacete: ['Capacete', 'must', '<path d="M5 15a7 7 0 0 1 14 0M3.5 15h17v2.5h-17zM12 8V6"/>'],
  botas: ['Botas de segurança', 'must', '<path d="M8 4h5v9l6 3v3H5v-4l3-2z"/>'],
  oculos: ['Óculos', 'must', '<circle cx="7" cy="13" r="3.2"/><circle cx="17" cy="13" r="3.2"/><path d="M10.2 13h3.6M3.8 13 3 9M20.2 13l.8-4"/>'],
  luvas: ['Luvas', 'must', '<path d="M8 21v-7l-3-3.5 1.2-1.2L9 11V5.5a1.2 1.2 0 0 1 2.4 0V10V4.5a1.2 1.2 0 0 1 2.4 0V10V5.5a1.2 1.2 0 0 1 2.4 0v7l1.6-1.6 1.1 1.1-3 5V21z"/>'],
  colete: ['Colete refletor', 'must', '<path d="M8.5 3 4 7v14h6v-9h4v9h6V7l-4.5-4L13 7h-2zM4 15h6M14 15h6"/>'],
  auditiva: ['Proteção auditiva', 'must', '<path d="M6 14v-2a6 6 0 0 1 12 0v2M4 14h4v6H4zM16 14h4v6h-4z"/>'],
  arnes: ['Arnês', 'must', '<circle cx="12" cy="4.5" r="1.8"/><path d="M8 21l1-8h6l1 8M8 9h8M9 9l3 4 3-4M12 2.7V1"/>'],
  saida: ['Saída de emergência', 'safe', '<circle cx="11" cy="4.5" r="1.7"/><path d="M6 21l3.5-6 2.5 2v4M5 11l3-3h3.5l2.5 3.5 2.5.5M9 8.5l-1.2 5.5M17.5 3h3v18h-3"/>'],
  encontro: ['Ponto de encontro', 'safe', '<path d="M3 3l5 5M21 3l-5 5M3 21l5-5M21 21l-5-5M3 3h4M3 3v4M21 3h-4M21 3v4M3 21h4M3 21v-4M21 21h-4M21 21v-4"/><circle cx="12" cy="12" r="2.4"/>'],
  socorro: ['Primeiros socorros', 'safe', '<path d="M12 5v14M5 12h14" stroke-width="4"/>'],
  extintor: ['Extintor', 'fire', '<path d="M9 9h6v12H9zM12 9V6M10 6h4.5l3 2.5M12 3.5V6"/>'],
  alarme: ['Alarme', 'fire', '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20.5a2 2 0 0 0 4 0"/>'],
  fumar: ['Proibido fumar', 'no', '<path d="M4 13h11v3H4zM17 13v3M19 13v3M17 10c0-2 2-1.5 2-4"/>'],
  cartao: ['O teu cartão', 'card', '<path d="M3 7h12v10H3zM6 14h4M18 9a4 4 0 0 1 0 6M20.5 6.5a7.5 7.5 0 0 1 0 11"/>'],
  autorizacao: ['Autorização de trabalho', 'card', '<path d="M7 3h7l4 4v14H7zM14 3v4h4M9.5 12h6M9.5 15.5h6M9.5 19l1.5-1.5 1.5 1.5 3-3"/>'],
  stop: ['Parar o trabalho', 'stopk', '<path d="M8 20v-8.5l-1.6-2a1.1 1.1 0 0 1 1.7-1.4L9.5 10V4.8a1.1 1.1 0 0 1 2.2 0V10V3.8a1.1 1.1 0 0 1 2.2 0V10V4.8a1.1 1.1 0 0 1 2.2 0V10V6.5a1.1 1.1 0 0 1 2.2 0V14c0 3.3-2 6-5 6z"/>'],
  queda: ['Risco de queda', 'warn', '<circle cx="13" cy="7" r="1.6"/><path d="M7 11.5l4-1.5 3 3 3-.5M11 10l-1 5-3 2.5M10 15l3.5 1.5L14 20M4 20h6"/>'],
  andaime: ['Andaime verificado', 'safe', '<path d="M5 21V4M19 21V4M5 9h14M5 15h14M5 9l14 6M5 4h14"/>'],
  gas: ['Gases perigosos', 'warn', '<path d="M7 18c-2 0-3-1.5-3-3 0-2 1.6-3 3-3 .3-2.5 2.2-4 4.5-4 2.6 0 4.2 1.8 4.5 4 1.8 0 3 1.3 3 3s-1.2 3-3 3z"/>'],
  quimico: ['Produto perigoso', 'ghs', '<path d="M9 4h6M10 4v5l-5 9h14l-5-9V4M8 14h8"/>'],
  inflamavel: ['Inflamável', 'ghs', '<path d="M12 4c1 3 4.5 5 4.5 9.5A4.5 4.5 0 0 1 7.5 13.5c0-2 1-3.2 2-4 0 1.5.8 2.5 1.8 2.8C11 9.5 11 6.5 12 4z"/><path d="M6 20h12"/>'],
  cadeado: ['Bloqueio com cadeado', 'must', '<rect x="6" y="11" width="12" height="9" rx="2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3M12 14.5v2.5"/>'],
  '112': ['Ligar 112', 'fire', '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'],
};
const picto = (k) => { const p = PICTO[k];
  const inner = p[1] === 'ghs' ? `<g transform="rotate(-45 12 12)">${p[2]}</g>` : p[2];
  return `<figure class="picto ${p[1]}"><svg viewBox="0 0 24 24" aria-hidden="true">${inner}${p[1] === 'no' ? '<path class="slash" d="M4.5 4.5l15 15"/>' : ''}</svg><figcaption>${esc(p[0])}</figcaption></figure>`; };
// A line of the script: its signs, and the words without the [tags].
function botLine(raw) {
  const signs = []; const text = String(raw).replace(/\[([a-z0-9]+)\]/gi, (m, k) => { k = k.toLowerCase(); if (PICTO[k]) { signs.push(k); return ''; } return m; }).replace(/[ \t]+/g, ' ').trim();
  return { signs, text };
}
const botLines = (body) => String(body || '').split(/\n\s*\n/).map((x) => botLine(x)).filter((x) => x.text || x.signs.length);
const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const words = (s) => (String(s).trim().match(/\S+/g) || []).length;
// The voice: the phone's own (pt-PT if it has one). Muted, or no Portuguese voice: the same pace, in silence.
const VOICE_KEY = 'gestnow.voz';
const Voice = {
  get on() { try { return localStorage.getItem(VOICE_KEY) !== '0'; } catch (_) { return true; } },
  set on(v) { try { localStorage.setItem(VOICE_KEY, v ? '1' : '0'); } catch (_) {} if (!v) this.stop(); },
  ok: () => 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function',
  async voice() {
    if (!this.ok()) return null;
    let vs = speechSynthesis.getVoices();
    if (!vs.length && !this.waited) { this.waited = true; await new Promise((r) => { speechSynthesis.addEventListener('voiceschanged', r, { once: true }); setTimeout(r, 1200); }); vs = speechSynthesis.getVoices(); }
    // The best Portuguese voice this phone has: Portugal first, then the neural / online ones (Google, Natural, Premium…).
    const score = (v) => (/^pt[-_]PT/i.test(v.lang) ? 100 : /^pt/i.test(v.lang) ? 10 : -1000) + (/natural|neural|premium|enhanced|melhorad|online/i.test(v.name) ? 8 : 0)
      + (/google/i.test(v.name) ? 6 : 0) + (v.localService === false ? 3 : 0);
    const best = vs.filter((v) => score(v) > 0).sort((a, b) => score(b) - score(a))[0];
    return best || null;
  },
  pace: (text) => (window.GESTNOW_TEST ? 60 : Math.max(1600, words(text) * 390)),   // ~2.6 words a second: slower than the server's 4 (sql/56 K2)
  stop() { this.gen = (this.gen || 0) + 1; if (this.ok()) speechSynthesis.cancel(); },
  // o: { face (an element that gets .talking), robot (the 3D one), onWord(i) (index of the word being said, for the subtitles) }.
  async say(text, o = {}) {
    if (o instanceof Element) o = { face: o };
    const gen = this.gen = (this.gen || 0) + 1; const t0 = Date.now(); const min = this.pace(text);
    const starts = []; String(text).replace(/\S+/g, (w, i) => { starts.push(i); return w; });
    let wi = -1; const word = (i) => { if (i === wi || gen !== this.gen) return; wi = i; if (o.onWord) o.onWord(i); if (o.robot) o.robot.word(); };
    // Words in time: from the voice when it reports them, else at an even pace over the expected length.
    let byVoice = false; const step = Math.max(120, min / Math.max(1, starts.length));
    const tick = setInterval(() => { if (!byVoice && gen === this.gen && wi < starts.length - 1) word(wi + 1); }, step); word(0);
    if (o.face) o.face.classList.add('talking'); if (o.robot) o.robot.talk(true);
    try {
      const v = this.on && text ? await this.voice() : null;
      if (v && gen === this.gen) {
        speechSynthesis.cancel();
        await new Promise((res) => {
          const u = new SpeechSynthesisUtterance(text); u.voice = v; u.lang = v.lang; u.rate = 1;
          u.onboundary = (e) => { if (e.name && e.name !== 'word') return; byVoice = true; let k = 0; while (k + 1 < starts.length && starts[k + 1] <= e.charIndex) k++; word(k); };
          u.onend = u.onerror = res; setTimeout(res, words(text) * 900 + 5000);   // a voice that never ends must not stop the bot
          speechSynthesis.speak(u);
        });
      }
      const rest = min - (Date.now() - t0); if (rest > 0 && gen === this.gen) await new Promise((r) => setTimeout(r, rest));
    } finally {
      clearInterval(tick); if (gen === this.gen && o.onWord) o.onWord(starts.length);
      if (o.face) o.face.classList.remove('talking'); if (o.robot) o.robot.talk(false);
    }
    return gen === this.gen;
  },
};
// The 3D robot (vendor/robo3d-1.js + robo3d.glb, ~0.7 MB, fetched only when a robot is on screen, then kept by the phone).
// Not on «save data», not without WebGL, not in the automatic tests unless asked: the drawn face stays instead.
let robotLibP = null;
function robotLib() {
  if (!robotLibP) robotLibP = new Promise((res) => {
    if (window.GNRobot) return res(window.GNRobot);
    const sc = document.createElement('script'); sc.src = 'vendor/robo3d-1.js'; sc.onload = () => res(window.GNRobot || null); sc.onerror = () => res(null); document.head.appendChild(sc);
  });
  return robotLibP;
}
const robots = new Set();
function dropRobots() { for (const r of robots) { try { r.dispose(); } catch (_) {} } robots.clear(); }
async function robotIn(el, look, from) {
  if (look !== 'robo' || !el || (window.GESTNOW_TEST && !window.GESTNOW_3D) || (navigator.connection && navigator.connection.saveData)) return null;
  const lib = await robotLib(); if (!lib || !lib.supported() || !el.isConnected) return null;
  try {
    const r = await lib.mount(el, { model: 'vendor/robo3d.glb', from });
    if (!r) return null;
    if (!el.isConnected) { r.dispose(); return null; }
    robots.add(r); el.classList.add('has3d'); return r;
  } catch (_) { return null; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getBot() {
  if (state.bot) return state.bot;
  const { data } = await sb.rpc('mini_bot');
  return (state.bot = data || { name: 'Hardy', look: 'robo' });
}
// One bot part of the onboarding: the bot talks, then asks; the server grades (55 I5) and keeps the clock (56 K2).
async function onbBot(x, items) {
  const ob = state.onb; const n = items.indexOf(x) + 1; const bot = ob.bot || { name: 'Hardy', look: 'robo' };
  const lines = botLines(x.body);
  onbShell(ob, `<div class="card bot-card"><div class="bot-head bot-stage" id="bhead"><div class="bot-3d" id="b3d">${botFace(bot.look)}</div>
      <div class="grow"><b>${esc(bot.name)}</b><small id="bst">Parte ${n} de ${items.length} · ${esc(x.title)}</small></div>
      <button class="iconbtn" id="voz" type="button" aria-pressed="${Voice.on}" aria-label="Voz" title="Ligar ou desligar a voz">${ic(Voice.on ? 'voice' : 'mute')}</button></div>
    <div class="bot-log" id="blog" aria-live="polite"><div class="bub bot"><p>Olá, ${esc(String(ob.name || '').split(' ')[0])}! Sou ${esc(bot.name)}. Esta conversa leva ${(() => { const m = Math.max(1, Math.round(lines.reduce((a, l) => a + Voice.pace(l.text), 0) / 60000)); return m === 1 ? 'um minuto' : `${m} minutos`; })()}. Liga o som do telemóvel.</p></div></div>
    <div class="bot-act" id="bact"><button class="btn big" id="bgo">${ic('play')}${x.opened_at ? 'Continuar a conversa' : 'Começar a conversa'}</button>
      <button class="btn ghost wide" id="back">Voltar à lista</button></div></div>`);
  const face = () => $('#bhead .botface'); const log = $('#blog'); const act = $('#bact');
  let live = true; let robot = null;
  robotIn($('#b3d'), bot.look, 0.18).then((r) => { robot = r; });
  const act3d = (name) => { if (robot) robot.play(name); };
  const alive = () => live && log.isConnected;
  const scroll = () => { const last = log.lastElementChild; if (last && last.scrollIntoView) last.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
  const add = (who, html) => { const d = document.createElement('div'); d.className = 'bub ' + who; d.innerHTML = html; log.appendChild(d); scroll(); return d; };
  const speak = async (l) => {
    const typing = add('bot typing', '<i></i><i></i><i></i>'); await sleep(550); typing.remove(); if (!alive()) return false;
    // The words light up as they are said (karaoke): who reads without sound follows at the same pace.
    const spoken = [l.text, ...l.signs.filter(() => !l.text).map((k) => PICTO[k][0])].join('. ');
    const ws = l.text ? l.text.split(/\s+/) : [];
    const b = add('bot', `${l.signs.length ? `<div class="signs">${l.signs.map(picto).join('')}</div>` : ''}${ws.length ? `<p class="kara">${ws.map((w) => `<span>${esc(w)}</span>`).join(' ')}</p>` : ''}`);
    const spans = [...b.querySelectorAll('.kara span')];
    const onWord = (i) => spans.forEach((sp, k) => { sp.classList.toggle('said', k < i); sp.classList.toggle('now', k === i); });
    const opts = () => ({ face: face(), robot, onWord });
    b.title = 'Toca para ouvir outra vez'; b.onclick = () => Voice.say(spoken, opts());
    return (await Voice.say(spoken, opts())) && alive();
  };
  $('#voz').onclick = () => { Voice.on = !Voice.on; $('#voz').setAttribute('aria-pressed', String(Voice.on)); $('#voz').innerHTML = ic(Voice.on ? 'voice' : 'mute'); };
  $('#back').onclick = () => { live = false; Voice.stop(); showOnboarding(); };
  $('#bgo').onclick = async () => {
    const { error } = await sb.rpc('mini_induction_open', { p_item: x.id });
    if (error) return toast(friendly(error));
    act.innerHTML = '<p class="small muted bot-hint">Toca numa mensagem para a ouvir outra vez.</p>'; act3d('Wave');
    for (const l of lines) if (!(await speak(l))) return;
    const answers = [];
    if (x.questions.length && !(await speak({ signs: [], text: `Agora ${x.questions.length === 1 ? 'uma pergunta' : x.questions.length + ' perguntas'} rápidas.` }))) return;
    for (const [i, q] of x.questions.entries()) {
      if (!(await speak({ signs: [], text: q.q }))) return;
      answers[i] = await new Promise((res) => {
        act.innerHTML = `<div class="bot-opts">${q.options.map((o, j) => `<button class="btn ghost" data-a="${j}">${esc(o)}</button>`).join('')}</div>`;
        act.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => res(Number(b.dataset.a)));
      });
      act.innerHTML = ''; add('me', `<p>${esc(q.options[answers[i]])}</p>`);
    }
    // «Já vi» on the server's clock: if the talk was faster than the minimum, wait the rest here.
    let seen;
    for (let k = 0; k < 4; k++) {
      const r = await sb.rpc('mini_induction_seen', { p_item: x.id });
      if (!r.error) { seen = r.data; break; }
      const m = /(\d+) s left/.exec(r.error.message || '');
      if (!m) return toast(friendly(r.error));
      act.innerHTML = `<p class="small muted bot-hint">${ic('clock')} Só mais ${esc(m[1])} segundos…</p>`;
      await sleep((Number(m[1]) + 1) * 1000); if (!alive()) return;
    }
    if (!seen) return toast('Tenta outra vez daqui a pouco.');
    let res = { passed: true, step_done: seen.step_done };
    if (x.questions.length) {
      const r = await sb.rpc('mini_induction_answer', { p_item: x.id, p_answers: answers });
      if (r.error) return toast(friendly(r.error));
      res = r.data;
    }
    if (res.passed) {
      act3d(res.step_done ? 'Dance' : 'ThumbsUp');
      await speak({ signs: [], text: x.questions.length ? 'Muito bem! Acertaste tudo.' : 'Muito bem! Já está.' });
      act.innerHTML = `<button class="btn big" id="bnext">${ic('ok')}${res.step_done ? 'Acolhimento concluído' : 'Passar à parte seguinte'}</button>`;
      $('#bnext').onclick = () => { live = false; Voice.stop(); if (res.step_done) toast('Acolhimento concluído. Obrigado!'); showOnboarding(); };
      return;
    }
    const bad = (res.wrong || []).map((i) => i + 1);
    act3d('No');
    await speak({ signs: [], text: `Ainda não. ${bad.length === 1 ? 'A pergunta ' + bad[0] + ' não está certa' : 'As perguntas ' + bad.join(' e ') + ' não estão certas'}. Vamos ouvir outra vez, com atenção.` });
    act.innerHTML = `<button class="btn big" id="bagain">${ic('play')}Ouvir outra vez</button><button class="btn ghost wide" id="back">Voltar à lista</button>`;
    $('#back').onclick = () => { live = false; Voice.stop(); showOnboarding(); };
    $('#bagain').onclick = async () => { live = false; Voice.stop(); const r2 = await sb.rpc('mini_onboarding'); if (r2.error) return toast(friendly(r2.error));
      r2.data.skew = new Date(r2.data.server_now).getTime() - Date.now(); state.onb = r2.data; onbBot(r2.data.items.find((y) => y.id === x.id), r2.data.items); };
  };
}

// «Encontra o perigo»: a picture of a work area; the worker taps each hazard (sql/58).
// Where the hazards are is never sent to the phone: each tap goes to the server, and only a hazard found comes back.
async function onbHunt(x, items) {
  const ob = state.onb; const n = items.indexOf(x) + 1; const bot = ob.bot || { name: 'Hardy', look: 'robo' };
  const total = x.hazards || 0; let found = (x.found || []).slice();
  onbShell(ob, `<div class="card hunt-card"><div class="hunt-head"><span class="hunt-face">${botFace(bot.look)}</span>
      <div class="grow"><b>${esc(bot.name)}</b><small>Parte ${n} de ${items.length} · ${esc(x.title)}</small></div>
      <span class="hunt-count" id="hcount" aria-live="polite"></span>
      <button class="iconbtn" id="voz" type="button" aria-pressed="${Voice.on}" aria-label="Voz" title="Ligar ou desligar a voz">${ic(Voice.on ? 'voice' : 'mute')}</button></div>
    <p class="hunt-say" id="hsay">${esc(x.body || '')}</p>
    <div class="hunt-scene" id="hscene"><img id="himg" src="scenes/${esc(x.scene)}.svg" alt="Zona de trabalho com perigos escondidos" draggable="false"><div class="hunt-marks" id="hmarks"></div>
      <div class="hunt-start" id="hstart"><button class="btn big" id="hgo">${ic('search')}${x.opened_at ? 'Continuar' : 'Começar a procurar'}</button></div></div>
    <ol class="hunt-list" id="hlist"></ol>
    <div class="bot-act" id="hact"><button class="btn ghost wide" id="back">Voltar à lista</button></div></div>`);
  const img = $('#himg'); const marks = $('#hmarks'); const list = $('#hlist'); const say = $('#hsay'); const act = $('#hact');
  let live = true; let busy = false;
  const alive = () => live && img.isConnected;
  const talk = (text) => { say.textContent = text; return Voice.say(text, { face: app.querySelector('.hunt-face .botface') }); };
  const count = () => { $('#hcount').innerHTML = `<b>${found.length}</b>/${total}`; $('#hcount').classList.toggle('all', found.length >= total); };
  const W = () => img.naturalWidth || 800; const H = () => img.naturalHeight || 1000;
  const mark = (h, fresh) => {
    const m = document.createElement('span'); m.className = 'hunt-ring' + (fresh ? ' fresh' : '');
    m.style.cssText = `left:${100 * h.x / W()}%;top:${100 * h.y / H()}%;width:${200 * h.r / W()}%`;
    m.textContent = String(found.indexOf(h) + 1); marks.appendChild(m);
    const li = document.createElement('li'); li.innerHTML = `<b>${esc(h.label)}</b><span>${esc(h.why)}</span>`; list.appendChild(li);
    if (fresh) li.scrollIntoView && li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const miss = (px, py) => { const m = document.createElement('span'); m.className = 'hunt-miss'; m.style.cssText = `left:${px}%;top:${py}%`; m.innerHTML = ic('x'); marks.appendChild(m); setTimeout(() => m.remove(), 900); };
  const redraw = () => { marks.innerHTML = ''; list.innerHTML = ''; found.forEach((h) => mark(h, false)); count(); };
  if (img.complete) redraw(); else img.onload = redraw;
  $('#voz').onclick = () => { Voice.on = !Voice.on; $('#voz').setAttribute('aria-pressed', String(Voice.on)); $('#voz').innerHTML = ic(Voice.on ? 'voice' : 'mute'); };
  $('#back').onclick = () => { live = false; Voice.stop(); showOnboarding(); };
  const finish = async () => {
    $('#hscene').classList.add('done');
    let seen;
    for (let k = 0; k < 4; k++) {
      const r = await sb.rpc('mini_induction_seen', { p_item: x.id });
      if (!r.error) { seen = r.data; break; }
      const m = /(\d+) s left/.exec(r.error.message || '');
      if (!m) return toast(friendly(r.error));
      act.innerHTML = `<p class="small muted bot-hint">${ic('clock')} Só mais ${esc(m[1])} segundos…</p>`;
      await sleep((Number(m[1]) + 1) * 1000); if (!alive()) return;
    }
    if (!seen) return toast('Tenta outra vez daqui a pouco.');
    if (x.questions.length) { live = false; return onbQuiz(x, n, items.length); }
    act.innerHTML = `<button class="btn big" id="hnext">${ic('ok')}${seen.step_done ? 'Acolhimento concluído' : 'Passar à parte seguinte'}</button>`;
    $('#hnext').onclick = () => { live = false; Voice.stop(); if (seen.step_done) toast('Acolhimento concluído. Obrigado!'); showOnboarding(); };
    await talk(`Muito bem! Encontraste os ${total} perigos. Na obra, quando vires um destes, para e avisa.`);
  };
  img.addEventListener('click', async (e) => {
    if (busy || !$('#hstart').hidden || found.length >= total) return;
    const r = img.getBoundingClientRect(); const fx = (e.clientX - r.left) / r.width; const fy = (e.clientY - r.top) / r.height;
    busy = true;
    const { data: t, error } = await sb.rpc('mini_hunt_tap', { p_item: x.id, p_x: Math.round(fx * W()), p_y: Math.round(fy * H()) });
    busy = false;
    if (error) return toast(friendly(error));
    if (!alive()) return;
    if (t.hit) {
      const h = { i: t.i, x: t.x, y: t.y, r: t.r, label: t.label, why: t.why }; found.push(h); mark(h, true); count();
      if (navigator.vibrate) navigator.vibrate(30);
      if (found.length >= total) { await talk(t.why); if (alive()) finish(); } else talk(t.why);
      return;
    }
    if (t.again) return toast('Esse já encontraste. Procura outro.');
    miss(100 * fx, 100 * fy);
    if (t.reset) { found = []; redraw(); return talk('Muitos toques ao calhas. Vamos começar de novo: olha com atenção antes de tocar.'); }
    if (t.misses_left <= 3) say.textContent = `Não é aí. ${t.misses_left === 1 ? 'Mais um engano' : `Mais ${t.misses_left} enganos`} e começas de novo.`;
  });
  $('#hgo').onclick = async () => {
    const { error } = await sb.rpc('mini_induction_open', { p_item: x.id });
    if (error) return toast(friendly(error));
    $('#hstart').hidden = true;
    if (found.length >= total) return finish();
    talk(found.length ? `Já encontraste ${found.length}. Faltam ${total - found.length}.` : x.body);
  };
}

// The guided tour: the bot shows each screen this person has, on the real menu. From «Mais» › «Visita guiada»,
// from the Acolhimento screen, and once by itself when someone finishes the onboarding.
const TOUR_TEXT = {
  equipa: 'A minha equipa: quem está na obra agora, quem ainda não chegou e o que tens de validar.',
  picar: 'Picar: o leitor de cartões. Cada pessoa encosta o cartão à entrada e à saída.',
  painel: 'Dashboard de obra: todas as obras num só ecrã, com o que precisa de atenção, vistas pela produção, faturação e secretariado.',
  naobra: 'Na obra: quem está lá dentro neste momento.',
  emergencia: 'Emergência: carregas no botão vermelho e cada pessoa pica o cartão no ponto de encontro. Vês logo quem está em falta, com o telefone.',
  lmra: 'LMRA: a análise de risco antes de começar. Um «Não» para o trabalho; com tudo «Sim», a equipa assina com o cartão.',
  armazem: 'Armazém: EPIs, farda e ferramentas. Quem recebe assina com o cartão; os tamanhos vêm da ficha.',
  horas: 'Horas: as horas da equipa, dia a dia, para corrigir e validar.',
  minhas: 'As minhas horas: as tuas horas, o teu mês, e os pedidos de férias e faltas. Se um dia estiver mal, dizes aqui.',
  secretariado: 'Secretaria: o mês de toda a gente, fechar o mês e tirar o ficheiro para os salários.',
  seguranca: 'Segurança: os documentos de cada pessoa, e o que impede alguém de entrar na obra.',
  trabalhadores: 'Pessoas: as fichas, os cartões e os documentos de cada colaborador.',
  acolhimento: 'Acolhimento: as conversas, os vídeos e os manuais que cada pessoa nova tem de fazer.',
  obras: 'Obras: as moradas, os horários e as regras de cada obra.',
  processo: 'Processo: o caminho de cada obra, do primeiro contacto ao fecho de contas. Toca num passo e eu explico o que vem antes e depois. O ponto de interrogação em cima diz-te onde estás.',
  clientes: 'Clientes: as empresas que usam a GestNow. Crias, entras numa e voltas.',
  orcamentos: 'Orçamentos: um só cálculo de custo e cinco formas de dar o preço ao cliente, de homem-hora a chave na mão. Quem assina segue as regras da tua empresa.',
};
async function startTour() {
  if (!state.ready || document.getElementById('tour')) return;
  openMore(false); closePalette();
  const bot = await getBot();
  const btn = (v) => nav.querySelector(`button[data-view="${v}"]`);
  const shown = MORE_ORDER.filter((v) => btn(v) && !btn(v).hidden && TOUR_TEXT[v]);
  const inMore = shown.filter((v) => btn(v).parentElement.id === 'more');
  const steps = [{ text: `Olá! Sou ${bot.name}. Vou mostrar-te a app num minuto. Toca em «Seguinte» quando quiseres.` }];
  for (const v of shown.filter((x) => !inMore.includes(x))) steps.push({ el: btn(v), text: TOUR_TEXT[v] });
  if (inMore.length) steps.push({ el: nav.querySelector('button[data-more]'), text: 'Em «Mais» tens o resto: ' + inMore.map((v) => btn(v).textContent.trim()).join(', ') + '. E é lá que sais da app.' });
  const search = document.getElementById('search'); if (search && !search.hidden) steps.push({ el: search, text: 'Procurar: escreve o nome de uma pessoa, de uma obra ou de um ecrã, e vais direto lá.' });
  steps.push({ text: 'É isto. Se quiseres ver outra vez, está em «Mais», «Visita guiada». Bom trabalho e em segurança!' });
  const ov = document.createElement('div'); ov.id = 'tour'; ov.className = 'tour'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Visita guiada');
  ov.innerHTML = `<div class="tour-hole" id="thole"></div><div class="tour-card" id="tcard"><div class="tour-3d">${botFace(bot.look)}</div><div class="grow"><b>${esc(bot.name)}</b><p id="ttx"></p>
    <div class="tour-acts"><span class="tour-dots" id="tdots"></span><button class="btn ghost small" id="tskip">Sair</button><button class="btn small" id="tnext">Seguinte</button></div></div></div>`;
  document.body.appendChild(ov);
  let i = 0; let robot = null;
  robotIn(ov.querySelector('.tour-3d'), bot.look, 0.12).then((r) => { robot = r; if (r) r.play('Wave'); });
  const end = () => { Voice.stop(); if (robot) { robots.delete(robot); robot.dispose(); } ov.remove(); window.removeEventListener('resize', place); };
  function place() {
    const s = steps[i]; const hole = ov.querySelector('#thole'); const card = ov.querySelector('#tcard');
    const r = s.el && s.el.getBoundingClientRect();
    if (!r || !r.width) { hole.hidden = true; ov.classList.add('dim'); card.style.top = ''; card.style.bottom = ''; card.classList.add('mid'); return; }
    ov.classList.remove('dim'); card.classList.remove('mid'); hole.hidden = false;
    Object.assign(hole.style, { left: r.left - 6 + 'px', top: r.top - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px' });
    if (r.top > window.innerHeight / 2) { card.style.top = ''; card.style.bottom = window.innerHeight - r.top + 18 + 'px'; }
    else { card.style.bottom = ''; card.style.top = r.bottom + 18 + 'px'; }
  }
  function show() {
    const s = steps[i];
    ov.querySelector('#ttx').textContent = s.text;
    ov.querySelector('#tdots').innerHTML = steps.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
    ov.querySelector('#tnext').textContent = i === steps.length - 1 ? 'Terminar' : 'Seguinte';
    place(); Voice.say(s.text, { face: ov.querySelector('#tcard .botface'), robot });
  }
  window.addEventListener('resize', place);
  ov.querySelector('#tskip').onclick = end;
  ov.querySelector('#tnext').onclick = () => { if (++i >= steps.length) return end(); show(); };
  ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') end(); });
  show(); ov.querySelector('#tnext').focus();
}
// Acolhimento screen: the company's bot (name and look), and a way to hear it and to see the tour.
async function loadBotCard() {
  const el = $('#ibot'); if (!el) return;
  dropRobots();
  const bot = await getBot(); if (!el.isConnected) return;
  el.innerHTML = `<div class="card bot-set"><div class="bot-3d set">${botFace(bot.look)}</div><div class="grow"><b>O vosso bot: ${esc(bot.name)}</b>
      <small>Apresenta as conversas do acolhimento e faz a visita guiada à app. Fala com a voz do telemóvel, sem custos.</small></div>
    <div class="bot-set-acts"><button class="btn ghost small" id="bhear">${ic('voice')}Ouvir</button><button class="btn ghost small" id="btour">${ic('bot')}Visita guiada</button><button class="btn small" id="bedit">Mudar</button></div></div>`;
  $('#bhear').onclick = async () => { if (!Voice.ok()) return toast('Este navegador não tem voz.'); if (!(await Voice.voice())) toast('Este telemóvel não tem voz em português: instala-a nas definições (Texto para voz).');
    if (robot) robot.play('Wave'); Voice.say(`Olá! Sou ${bot.name}, e vou receber as pessoas novas da empresa.`, { face: el.querySelector('.botface'), robot }); };
  $('#btour').onclick = startTour;
  let robot = null; robotIn(el.querySelector('.bot-3d'), bot.look, 0).then((r) => { robot = r; });
  $('#bedit').onclick = async () => {
    const fd = await askSheet('O vosso bot', `<label for="bn">Nome</label><input id="bn" name="name" required minlength="2" maxlength="30" value="${esc(bot.name)}">
      <label>Aspeto</label><div class="bot-looks" role="radiogroup">${Object.entries(BOT_LOOKS).map(([k, t]) => `<label class="bot-look"><input type="radio" name="look" value="${k}" ${bot.look === k ? 'checked' : ''}>${botFace(k)}<span>${esc(t)}</span></label>`).join('')}</div>`, 'Guardar');
    if (!fd) return;
    const { data, error } = await sb.rpc('mini_bot_save', { p_name: String(fd.get('name')).trim(), p_look: fd.get('look') || 'robo' });
    if (error) return toast(friendly(error));
    state.bot = data; toast('Guardado.'); loadBotCard();
  };
}

// ------------------------------------------------------------------ Segurança
function viewSafety() {
  app.innerHTML = `<div class="ph"><div><p class="ph-k">Documentos e acessos</p><h1>Segurança</h1></div></div>
    <div class="toolbar noprint"><div class="tb-site">${siteSelect('site')}</div></div><div id="list" style="margin-top:14px">${skel(3)}</div>
    <p class="noprint"><button class="btn ghost wide" id="print">${ic('print')}Imprimir</button></p>
    ${can('documentos.regras') ? `<h2 class="noprint">O que trava a entrada</h2><div class="card noprint" id="types"></div>` : ''}`;
  bindSiteSelect('site', loadSafety);
  $('#print').onclick = () => window.print();
  loadSafety();
  if (can('documentos.regras')) showDocTypes();
}
async function loadSafety() {
  const el = $('#list'); const site = currentSite(); if (!el) return;
  if (!site) { el.innerHTML = ''; return; }
  const { data, error } = await sb.rpc('mini_safety_alerts', { p_project: site.id });
  if (error) { el.innerHTML = `<p>${esc(friendly(error))}</p>`; return; }
  const blocked = new Set(data.filter((r) => r.is_blocking && r.state !== 'a_caducar').map((r) => r.collaborator_id));
  if (!data.length) { el.innerHTML = `<div class="card">${empty('check', 'Tudo em dia', `Ninguém atribuído a ${site.title} tem documentos em falta ou a caducar.`)}</div>`; return; }
  const label = { em_falta: 'em falta', caducado: 'caducado', a_caducar: 'a caducar' };
  const byP = new Map();
  for (const r of data) { const p = byP.get(r.collaborator_id) || { id: r.collaborator_id, name: r.full_name, num: r.employee_number, docs: [] }; p.docs.push(r); byP.set(r.collaborator_id, p); }
  const soon = [...byP.values()].filter((p) => !blocked.has(p.id)).length;
  el.innerHTML = `${blocked.size ? `<div class="alert bad">${ic('shield')}<div><span class="big-count">${blocked.size}</span> pessoa(s) <b>não podem entrar</b> em ${esc(site.title)}</div></div>`
      : `<div class="alert ok">${ic('shield')}<div><span class="big-count">${blocked.size}</span> pessoa(s) <b>não podem entrar</b> em ${esc(site.title)}</div></div>`}
    ${soon ? `<p class="small muted">${soon} pessoa(s) com documentos a caducar ou que não travam.</p>` : ''}
    <div class="list">${[...byP.values()].sort((a, b) => blocked.has(b.id) - blocked.has(a.id)).map((p) => `<div class="card link" data-id="${esc(p.id)}" role="button" tabindex="0">
      <div class="wk">${avatar(p.name)}<div class="grow"><div class="nm">${esc(p.name)}</div><div class="sub">${p.num ? 'nº ' + esc(p.num) : ''}</div></div>
        ${blocked.has(p.id) ? chip('bad', 'não entra', 'x') : chip('warn', 'atenção', 'warn')}</div>
      <div class="tags">${p.docs.map((r) => `<span class="chip ${r.state === 'a_caducar' || !r.is_blocking ? 'warn' : 'bad'} wrap">${esc(r.document)}: ${label[r.state]}${r.expiration_date ? ' ' + esc(fmtDate(r.expiration_date)) : ''}${r.is_blocking ? '' : ' (não trava)'}</span>`).join('')}</div></div>`).join('')}</div>
    ${canDocs() ? '<p class="small muted noprint">Toca numa pessoa para registar o documento.</p>' : ''}`;
  el.querySelectorAll('.link').forEach((c) => c.onclick = () => { state.worker = c.dataset.id; go('ficha'); });
}
function showDocTypes() {
  const el = $('#types'); if (!el) return;
  el.innerHTML = `<p class="small muted">Sem um documento que trava válido, a entrada é recusada.</p>
    ${state.docTypes.map((t) => `<label class="check"><input type="checkbox" data-type="${esc(t.id)}" ${t.is_blocking ? 'checked' : ''}> ${esc(t.name)}</label>`).join('')}`;
  el.querySelectorAll('input[data-type]').forEach((cb) => cb.onchange = async () => {
    const why = prompt(cb.checked ? 'Porque é que este documento passa a travar a entrada?' : 'Porque é que este documento deixa de travar a entrada?');
    if (!why) { cb.checked = !cb.checked; return; }
    const { error } = await sb.rpc('mini_set_document_blocking', { p_type: cb.dataset.type, p_blocking: cb.checked, p_reason: why });
    if (error) { cb.checked = !cb.checked; return toast(friendly(error)); }
    await loadBasics(); toast('Guardado.'); loadSafety();
  });
}

// ------------------------------------------------------------------ Horas
function monday(d) { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function viewHours() {
  if (!state.weekStart) state.weekStart = monday(new Date());
  const from = state.weekStart; const to = new Date(from); to.setDate(to.getDate() + 6);
  const site = currentSite(); const tz = site ? siteTz(site.id) : DEFAULT_TZ;
  const short = (d) => d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
  const thisWeek = isoDay(from) === isoDay(monday(new Date()));
  app.innerHTML = `<div class="ph"><div><p class="ph-k">Horas da obra</p><h1>Mapa de horas</h1></div></div>
    <div class="toolbar noprint"><div class="tb-site">${siteSelect('site')}</div>
      <div class="weeknav"><button class="iconbtn" id="prev" aria-label="Semana anterior">‹</button>
      <div class="wk-l"><b>${esc(short(from))} – ${esc(short(to))}</b><span>${thisWeek ? 'Esta semana' : esc(tzName(tz))}</span></div>
      <button class="iconbtn" id="next" aria-label="Semana seguinte">›</button></div></div>
    <p class="print-only"><b>Semana de ${esc(fmtDate(isoDay(from)))} a ${esc(fmtDate(isoDay(to)))}</b></p>
    <div id="hsum"></div>
    <div id="list">${skel(3)}</div>
    <div class="hacts noprint"><button class="btn big" id="all" hidden>${ic('ok')}Validar todos os dias sem problemas</button>
      <button class="btn ghost" id="print">${ic('print')}Imprimir</button></div>
    <div class="card noprint" id="fix" hidden></div>
    ${canPdCases() ? `<div class="card noprint" data-pdcases="auto" hidden style="margin-top:16px"><h2 style="margin-top:0">Diárias: faltas</h2>
      <p class="small muted">Dias com diária já paga em que a pessoa faltou ou fez menos horas que o mínimo. Desconta, ou aceita a justificação.</p>
      <div id="pdhours"></div></div>` : ''}
    <div class="card noprint" style="margin-top:16px"><h2 style="margin-top:0">Picagem esquecida</h2>
      <p class="small muted">Acrescenta uma entrada ou saída que faltou, com o motivo.</p>
      ${more('Regras', `<p>Escreve a hora como se vê no relógio da obra (${esc(tzName(tz))}). Fica marcada como acrescentada à mão, com o teu nome e o motivo.
          Não podes acrescentar picagens a ti próprio. Uma entrada só é aceite se a pessoa podia entrar a essa hora (ativa, com os documentos).</p>`)}
      <form id="miss"><label>Trabalhador</label><select name="who" id="who"></select>
        <div class="row"><div><label>Entrada ou saída</label><select name="dir"><option value="in">Entrada</option><option value="out">Saída</option></select></div>
        <div><label>Dia e hora * <span class="small muted">(${esc(tzName(tz))})</span></label><input name="at" type="datetime-local" required></div></div>
        <label>Porquê? *</label><input name="why" required placeholder="ex.: esqueceu-se de picar à saída, confirmado por mim">
        <p style="margin-top:16px"><button class="btn wide">Acrescentar</button></p></form></div>`;
  bindSiteSelect('site', viewHours);
  $('#prev').onclick = () => { state.weekStart.setDate(state.weekStart.getDate() - 7); viewHours(); };
  $('#next').onclick = () => { state.weekStart.setDate(state.weekStart.getDate() + 7); viewHours(); };
  $('#print').onclick = () => window.print();
  $('#miss').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const s = currentSite(); if (!s) return;
    if (!f.get('who')) return toast('Escolhe o trabalhador.');
    // The time typed is the site's time (A6): 08:00 in a Madrid site is 08:00 in Madrid, whatever the phone's zone.
    const at = zonedToUtc(String(f.get('at') || ''), siteTz(s.id)); if (!at) return toast('Escreve o dia e a hora.');
    const { error } = await sb.rpc('mini_add_missed_tap', { p_collab: f.get('who'), p_project: s.id, p_direction: f.get('dir'),
      p_time: at, p_reason: f.get('why') });
    if (error) return toast(friendly(error));
    toast('Picagem acrescentada.'); viewHours();
  };
  const pre = state.prefill; state.prefill = null;
  if (site) loadPdCases('#pdhours', site.id);
  loadHours(isoDay(from), isoDay(to)).then((rows) => fillWorkerSelect(rows || []).then(() => {
    if (!pre) return;
    const f = $('#miss'); if (!f) return;
    if (pre.who) setWorker(pre.who, pre.name); f.dir.value = pre.dir; f.at.value = pre.at; f.why.value = pre.why || '';
    f.scrollIntoView({ behavior: 'smooth' });
  }));
}
// Everyone on the site today, plus whoever has hours this week (someone who left the site or was deactivated
// still needs their days corrected, M8).
async function fillWorkerSelect(rows) {
  const sel = document.getElementById('who'); const site = currentSite(); if (!sel || !site) return;
  const { data } = await sb.rpc('mini_workers');
  const list = (data || []).filter((w) => w.is_active && w.site_ids.includes(site.id)).map((w) => ({ id: w.collaborator_id, name: w.full_name }));
  for (const r of rows) if (!list.some((x) => x.id === r.collaborator_id)) list.push({ id: r.collaborator_id, name: r.full_name + ' (já não está na obra)' });
  if (!document.getElementById('who')) return;
  const keep = sel.value; const keepName = keep && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '';
  sel.innerHTML = list.length ? '<option value="">Escolhe…</option>' + list.map((w) => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('')
    : '<option value="">Ninguém atribuído a esta obra</option>';
  if (keep) setWorker(keep, keepName);   // a day being corrected keeps its person
}
function setWorker(id, name) {
  const sel = document.getElementById('who'); if (!sel) return;
  if (![...sel.options].some((o) => o.value === id)) sel.add(new Option(name || 'Trabalhador', id));
  sel.value = id;
}
// Status chips: the same words and colours on every screen.
const DAY_STATUS = { registered: chip('reg', 'por validar'), supervisor_validated: chip('val', 'validado', 'ok'),
  hr_validated: chip('apr', 'aprovado', 'ok'), sent_to_payroll: chip('fech', 'fechado') };
const dayLabel = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'short', day: '2-digit', month: '2-digit' });
// One day of one person: date, periods on one line (wrapping only between periods), hours on the right, status.
function periodsOf(r, periods, tz) {
  const list = periodList(periods);
  return list.length ? list : (r.first_in || r.last_out ? [`${fmtHour(r.first_in, tz) || '?'}–${fmtHour(r.last_out, tz) || '?'}`] : []);
}
// The week at a glance: one bar per day, its height the hours worked and its colour the state of that day.
function weekStrip(rows, from, tz, today) {
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(from + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });
  const max = Math.max(600, ...rows.map((r) => r.worked_minutes));
  return `<div class="wstrip noprint" aria-hidden="true">${days.map((d, i) => {
    const r = rows.find((x) => x.shift_date === d);
    const k = !r ? 'none' : onlyOpenToday(r, tz) ? 'open' : r.anomalies.length ? 'bad' : r.status === 'registered' ? 'todo' : 'ok';
    const h = r ? Math.max(6, Math.round((r.worked_minutes / max) * 100)) : 0;
    return `<div class="ws ${k}${d === today ? ' today' : ''}"><div class="ws-bar"><i style="height:${h}%"></i></div>
      <b>${r ? esc(fmtMin(r.worked_minutes).replace('h00', 'h')) : '–'}</b><span>${['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'][i]}</span></div>`;
  }).join('')}</div>`;
}
let hoursSeq = 0;
async function loadHours(from, to) {
  const el = $('#list'); const site = currentSite(); if (!el) return [];
  if (!site) { el.innerHTML = `<div class="card">${empty('helmet', 'Sem obras abertas', 'Abre uma obra em Obras.')}</div>`; return []; }
  const seq = ++hoursSeq; const tz = siteTz(site.id);
  const [{ data, error }, back, per] = await Promise.all([sb.rpc('mini_hours', { p_project: site.id, p_from: from, p_to: to }),
    sb.rpc('mini_returned_days', { p_project: site.id, p_from: from, p_to: to }), dayPeriods(from, to, site.id)]);
  if (seq !== hoursSeq || !$('#list')) return [];   // a newer week or site was asked meanwhile
  if (error) { el.innerHTML = `<p>${esc(friendly(error))}</p>`; return []; }
  const returned = Object.fromEntries(((back && back.data) || []).map((b) => [b.work_day_id, b.reason]));
  if (!data.length) { el.innerHTML = `<div class="card">${empty('calendar', 'Sem horas nesta semana', 'As horas aparecem aqui quando as pessoas picarem nesta obra.')}</div>`; return []; }
  const byWorker = {};
  for (const r of data) (byWorker[r.collaborator_id] = byWorker[r.collaborator_id] || []).push(r);
  const me = state.me && state.me.collaborator_id;
  const today = localDay(new Date().toISOString(), tz); const nowP = tzParts(Date.now(), tz);
  const fixBtn = (r, label, cls) => `<button class="btn ${cls} small" data-${label === 'Corrigir' ? 'fix' : 'taps'}="${esc(r.collaborator_id)}" data-day="${esc(r.shift_date)}" data-name="${esc(r.full_name)}">${label}</button>`;
  const actions = (r) => {
    if (!['registered', 'supervisor_validated'].includes(r.status) || r.collaborator_id === me) return '';
    let b;
    if (r.status !== 'registered' || onlyOpenToday(r, tz)) b = fixBtn(r, 'Picagens', 'ghost');
    else if (r.anomalies.length && r.anomalies.every((a) => a === 'missing_out' || a === 'open_shift')) b = `<button class="btn small" data-out="${esc(r.work_day_id)}">${ic('out')}Marcar saída</button>` + fixBtn(r, 'Picagens', 'ghost');
    else if (r.anomalies.length) b = fixBtn(r, 'Corrigir', '');
    else if (r.overtime_minutes) b = `<button class="btn small" data-ok="${esc(r.work_day_id)}" data-ot="1">Validar com extra</button>
              <button class="btn ghost small" data-ok="${esc(r.work_day_id)}" data-ot="0">Sem extra</button>` + fixBtn(r, 'Picagens', 'ghost');
    // hours on a rest day or holiday enter the timesheet (pay and client billing) only if the team leader approves them
    else if (r.special_day_minutes) b = `<button class="btn small" data-ok="${esc(r.work_day_id)}" data-ot="1">Aprovar as ${esc(fmtMin(r.special_day_minutes))}</button>
              <button class="btn ghost small" data-ok="${esc(r.work_day_id)}" data-ot="0">Não aprovar</button>` + fixBtn(r, 'Picagens', 'ghost');
    else b = `<button class="btn small" data-ok="${esc(r.work_day_id)}">Validar</button>` + fixBtn(r, 'Picagens', 'ghost');
    return `<div class="acts noprint">${b}</div>`;
  };
  const n = { todo: 0, anom: 0, ok: 0, open: 0 };
  el.innerHTML = Object.values(byWorker).map((rows) => {
    const tot = rows.reduce((a, r) => ({ w: a.w + r.worked_minutes, o: a.o + r.overtime_minutes }), { w: 0, o: 0 });
    return `<div class="card pcard"><div class="wk">${avatar(rows[0].full_name)}<div class="grow"><h2 style="margin:0;font-size:18px">${esc(rows[0].full_name)}</h2>
      <div class="sub">${rows[0].employee_number ? 'nº ' + esc(rows[0].employee_number) : ''}</div></div>
      <div class="ptop"><b class="tnum">${esc(fmtMin(tot.w))}</b><span>${tot.o ? esc(fmtMin(tot.o)) + ' extra' : 'na semana'}</span></div></div>
    ${weekStrip(rows, from, tz, today)}
    ${rows.map((r) => {
      const anom = r.anomalies.length; if (onlyOpenToday(r, tz)) n.open++; else if (anom) n.anom++; else if (r.status === 'registered') n.todo++; else n.ok++;
      const list = periodsOf(r, per[r.work_day_id], tz);
      return `<div class="day"><div class="day-h"><span class="d">${esc(dayLabel(r.shift_date))}</span>
        ${anom ? `<span class="chip ${onlyOpenToday(r, tz) ? 'warn' : 'anom'}">${ic(onlyOpenToday(r, tz) ? 'clock' : 'warn')}${esc(r.anomalies.map((a) => anomalyText(a, r.shift_date, tz)).join(', '))}</span>` : DAY_STATUS[r.status] || chip('', r.status)}
        <span class="hrs">${esc(fmtMin(r.worked_minutes))}</span></div>
      <div class="per">${periodsHtml(list) || '<span class="muted">sem picagens</span>'}</div>
      ${list.length ? dayline(list.join(' · '), r.shift_date === today ? { now: (nowP.hour % 24) * 60 + nowP.minute } : {}) : ''}
      ${r.overtime_minutes || r.special_day_minutes || r.has_manual || returned[r.work_day_id] ? `<div class="tags">
        ${r.overtime_minutes ? chip(r.overtime_approved === false ? '' : 'info', `${fmtMin(r.overtime_minutes)} extra${r.overtime_approved === false ? ' (recusadas)' : ''}`) : ''}
        ${r.special_day_minutes ? chip(r.overtime_approved ? 'info' : r.overtime_approved === false ? '' : 'warn', `${fmtMin(r.special_day_minutes)} em descanso ou feriado${r.overtime_approved ? ' (aprovadas)' : r.overtime_approved === false ? ' (não aprovadas)' : ': por aprovar'}`) : ''}
        ${r.has_manual ? chip('', 'tem picagem à mão') : ''}
        ${returned[r.work_day_id] ? chip('dev', 'devolvido pelo secretariado') : ''}</div>` : ''}
      ${returned[r.work_day_id] ? `<div class="note">${esc(returned[r.work_day_id])}</div>` : ''}
      ${actions(r)}</div>`; }).join('')}
    <div class="ptotal"><span>Total da semana</span><span class="hrs">${esc(fmtMin(tot.w))}${tot.o ? ` <span class="small">(${esc(fmtMin(tot.o))} extra)</span>` : ''}</span></div></div>`;
  }).join('') + '<p class="small muted print-only">Assinatura do encarregado: ______________________</p>';
  const sum = $('#hsum');
  if (sum) sum.innerHTML = `<div class="kpis noprint"><div class="kpi ${n.todo ? 'hot' : ''}"><b>${n.todo}</b><span>dias a validar</span></div>
    <div class="kpi ${n.anom ? 'warn' : ''}"><b>${n.anom}</b><span>com problemas</span></div><div class="kpi ok"><b>${n.ok}</b><span>validados</span></div></div>`;
  // Bulk validation only for plain days: no problem, no overtime, not one's own, and never a day the office sent back (M4).
  const easy = data.filter((r) => r.status === 'registered' && !r.anomalies.length && !r.overtime_minutes && !r.special_day_minutes && r.collaborator_id !== me && !returned[r.work_day_id]);
  const all = $('#all'); if (all) { all.hidden = !easy.length; all.lastChild.textContent = `Validar ${easy.length} dia(s) sem problemas`; all.onclick = () => validate(easy.map((r) => r.work_day_id), null); }
  el.querySelectorAll('button[data-ok]').forEach((b) => b.onclick = () =>
    validate([b.dataset.ok], b.dataset.ot === undefined ? null : b.dataset.ot === '1'));
  el.querySelectorAll('button[data-fix], button[data-taps]').forEach((b) => b.onclick = () => fixDay(b.dataset.fix || b.dataset.taps, b.dataset.day, b.dataset.name));
  el.querySelectorAll('button[data-out]').forEach((b) => b.onclick = async () => {
    const r = data.find((x) => x.work_day_id === b.dataset.out); if (!r) return;
    if (await markOut({ id: r.collaborator_id, name: r.full_name, day: r.shift_date, since: r.first_in, project: site.id })) viewHours();
  });
  return data;
}
async function validate(ids, overtime) {
  const { data, error } = await sb.rpc('advance_work_days', { p_ids: ids, p_to: 'supervisor_validated', p_overtime_approved: overtime });
  if (error) return toast(friendly(error));
  toast(`${data} dia(s) validado(s).`); viewHours();
}
// The taps of the day (and the days around it), each one with "Anular"; and the form pointed at the missing one (M8, A2).
async function fixDay(collabId, day, name) {
  const site = currentSite(); if (!site) return; const tz = siteTz(site.id);
  const { data, error } = await sb.rpc('mini_day_events', { p_collab: collabId, p_project: site.id, p_day: day });
  if (error) return toast(friendly(error));
  const taps = data || [];
  const box = $('#fix'); if (!box) return;
  box.hidden = false;
  box.innerHTML = `<h2 style="margin-top:0">Picagens de ${esc(name || '')}, ${esc(fmtDate(day))}</h2>
    <p class="small muted">Com o dia antes e o dia depois · ${esc(tzName(tz))}.</p>
    ${more('Anular uma picagem errada', '<p>Uma picagem errada (por exemplo uma ENTRADA picada em vez de SAÍDA) anula-se aqui, com o motivo: fica no registo como anulada e as horas são recalculadas.</p>')}
    ${taps.length ? taps.map((e) => `<div class="day wk${localDay(e.effective_time, tz) === day ? '' : ' muted'}">
      ${chip(e.direction === 'in' ? 'ok' : 'val', e.direction === 'in' ? 'Entrada' : e.direction === 'out' ? 'Saída' : e.direction)}
      <div class="grow"><b class="tnum">${esc(fmtTime(e.effective_time, tz))}</b>${e.manual ? `<div class="small muted">à mão: ${esc(e.manual_reason || '')}</div>` : ''}</div>
      <button class="btn small ghost" data-void="${esc(e.event_id)}">Anular</button></div>`).join('') : '<p class="muted">Sem picagens.</p>'}
    <p><button class="btn ghost wide" id="fixclose">Fechar</button></p>`;
  $('#fixclose').onclick = () => { box.hidden = true; };
  box.querySelectorAll('button[data-void]').forEach((b) => b.onclick = () => voidTap(b.dataset.void, collabId, day, name));
  const f = $('#miss'); setWorker(collabId, name);
  // The site's date, not the UTC one: a Madrid night-shift entry at 00:30 belongs to its own day (B3).
  const hasIn = taps.some((e) => e.direction === 'in' && localDay(e.effective_time, tz) === day);
  f.dir.value = hasIn ? 'out' : 'in';
  f.at.value = day + (hasIn ? 'T17:00' : 'T08:00');
  box.scrollIntoView({ behavior: 'smooth' });
}
async function voidTap(eventId, collabId, day, name) {
  const why = prompt('Porque é que anulas esta picagem? (pelo menos 10 letras; fica no registo com o teu nome)');
  if (why === null) return;
  if (String(why).trim().length < 10) return toast('Escreve o motivo (pelo menos 10 letras).');
  const { error } = await sb.rpc('mini_void_tap', { p_event: eventId, p_reason: String(why).trim() });
  if (error) return toast(friendly(error));
  toast('Picagem anulada. As horas do dia foram recalculadas.');
  viewHours(); fixDay(collabId, day, name);
}

// ------------------------------------------------------------------ Folha de baixo (dialog) e "Marcar saída"
// A sheet from the bottom with a small form. Resolves with the FormData, or null if cancelled.
function askSheet(title, body, okLabel, onOpen) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog'); d.className = 'dlg';
    d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2>${body}
      <div class="acts"><button class="btn big" value="ok">${esc(okLabel)}</button>
      <button class="btn ghost wide" value="cancel" formnovalidate>Cancelar</button></div></form>`;
    const form = d.querySelector('form'); let fd = null;
    form.addEventListener('submit', (e) => { if (e.submitter && e.submitter.value && e.submitter.value !== 'cancel') { fd = new FormData(form); fd.set('_v', e.submitter.value); } });
    d.addEventListener('close', () => { d.remove(); resolve(fd); });
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });   // tap outside = cancel
    document.body.appendChild(d); d.showModal(); if (onOpen) onOpen(d);
  });
}
// The usual reasons, one tap; "Outro" asks for the words. Each one is long enough for the server (10 letters).
const OUT_REASONS = ['Esqueceu-se de picar a saída', 'O cartão não leu à saída', 'Saiu mais cedo, com autorização', 'Saiu na hora normal, confirmado por mim'];
// An exit someone forgot, in two taps: the time (the site's clock) and why. p = { id, name, day, since, project }.
async function markOut(p) {
  const tz = siteTz(p.project); const today = localDay(new Date().toISOString(), tz);
  const nowIn = localInput(new Date().toISOString(), tz);
  const sinceTxt = p.since ? `Entrou ${p.day === localDay(p.since, tz) ? 'às ' + fmtHour(p.since, tz) : fmtTime(p.since, tz)}.` : '';
  const fd = await askSheet(`Marcar saída de ${p.name}`, `
    <p class="small muted">${esc(fmtDate(p.day))}${sinceTxt ? ' · ' + esc(sinceTxt) : ''} Hora da obra (${esc(tzName(tz))}).</p>
    <div class="row"><div><label for="od">Dia</label><input id="od" name="d" type="date" required value="${esc(p.day)}" max="${esc(today)}"></div>
      <div><label for="ot">Hora da saída *</label><input id="ot" name="t" type="time" required autofocus value="${p.day === today ? esc(nowIn.slice(11)) : ''}"></div></div>
    <label>Porquê? *</label><div class="chips reasons" role="radiogroup">${OUT_REASONS.map((r, i) => `<label class="chip"><input type="radio" name="r" value="${esc(r)}" ${i ? '' : 'required'}>${esc(r)}</label>`).join('')}
      <label class="chip"><input type="radio" name="r" value="">Outro motivo</label></div>
    <input name="x" id="ox" placeholder="Escreve o motivo" hidden maxlength="200">
    <p class="small muted">Fica marcada como posta à mão, com o teu nome e o motivo. O escritório vê-a.</p>`, 'Marcar saída', (d) => {
    const x = d.querySelector('#ox');
    d.querySelectorAll('input[name=r]').forEach((r) => r.onchange = () => { x.hidden = r.value !== ''; x.required = r.value === ''; if (!x.hidden) x.focus(); });
  });
  if (!fd) return false;
  const at = zonedToUtc(`${fd.get('d')}T${fd.get('t')}`, tz);
  const why = String(fd.get('r') || fd.get('x') || '').trim();
  if (!at) { toast('Escreve a hora da saída.'); return false; }
  if (new Date(at) > new Date(Date.now() + 60000)) { toast('A hora da saída não pode ser depois de agora.'); return false; }
  if (p.since && new Date(at) <= new Date(p.since)) { toast(`A saída tem de ser depois da entrada (${fmtTime(p.since, tz)}).`); return false; }
  if (why.length < 10) { toast('Escreve o motivo (pelo menos 10 letras).'); return false; }
  const { error } = await sb.rpc('mini_add_missed_tap', { p_collab: p.id, p_project: p.project, p_direction: 'out', p_time: at, p_reason: why });
  if (error) { toast(friendly(error)); return false; }
  toast(`Saída marcada: ${p.name}, ${fmtTime(at, tz)}.`);
  return true;
}

// ------------------------------------------------------------------ As minhas horas (any profile with a person behind it)
// The worker's start screen: today, the week, the month in big numbers, a calendar of the month, what they will earn
// (only if the company switches it on), the site card and the diárias. Every number comes from the official taps.
const MINE_STATE = { registered: 'por validar', supervisor_validated: 'validado na obra', hr_validated: 'aprovado no escritório', sent_to_payroll: 'fechado para salários' };
function viewMine() {
  if (!state.me.collaborator_id) return go((TABS[state.me.role] || TABS.supervisor)[0]);
  if (!state.mineMonth) state.mineMonth = isoDay(new Date()).slice(0, 7);
  const months = [0, 1, 2].map((k) => { const d = new Date(); d.setDate(15); d.setMonth(d.getMonth() - k); return isoDay(d).slice(0, 7); });
  const mName = (ym) => new Date(ym + '-15T12:00:00').toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
  const me = state.people.find((x) => x.id === state.me.collaborator_id);
  app.innerHTML = `<div class="ph"><div><p class="ph-k">${esc((me && me.full_name) || '')}</p><h1>As minhas horas</h1></div></div>
    <div class="chips" style="margin-bottom:12px">${months.map((m) => `<button class="chip" data-m="${m}" aria-pressed="${m === state.mineMonth}">${esc(mName(m))}</button>`).join('')}</div>
    <div class="mine-grid"><div><div id="minetop">${skel(1)}</div><div id="minepay"></div><div id="mine">${skel(3)}</div></div>
    <div><div id="minereq"></div><div id="minesite"></div><div id="pdmine"></div></div></div>`;
  loadMyPerDiems(); loadMyRequests();
  app.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { state.mineMonth = b.dataset.m; viewMine(); });
  loadMine();
  state.timer = setInterval(() => { if (state.view === 'minhas' && document.visibilityState === 'visible') loadMine(true); }, 60000);
}
async function loadMine(quiet) {
  const ym = state.mineMonth;
  const { data: d, error } = await sb.rpc('mini_my_home', { p_month: ym + '-01' });
  const el = $('#mine'); if (!el || ym !== state.mineMonth) return;
  if (error) { el.innerHTML = `<p>${esc(friendly(error))}</p>`; $('#minetop').innerHTML = ''; return; }
  state.mineData = d;
  $('#minetop').innerHTML = mineHero(d);
  $('#minepay').innerHTML = minePay(d);
  $('#minesite').innerHTML = mineSite(d.site);
  if (quiet && el.dataset.ym === ym) return;
  el.dataset.ym = ym;
  const t = d.totals || {};
  const openNow = (r) => r.anomalies.length > 0 && r.anomalies.every((a) => a === 'open_shift') && r.date >= (d.today || {}).date;
  if (!d.days.length) { el.innerHTML = `<div class="card">${empty('clock', 'Sem horas neste mês', 'Os dias aparecem aqui depois de picares na obra.')}</div>`; return; }
  el.innerHTML = `<div class="kpis k4 mine-kpis">
      <div class="kpi big"><b>${esc(fmtMin(t.worked))}</b><span>Total do mês</span></div>
      <div class="kpi info"><b>${esc(fmtMin(t.overtime))}</b><span>horas extra</span></div>
      <div class="kpi"><b>${t.days}</b><span>dias trabalhados</span></div>
      <div class="kpi ${t.validated === t.rows ? 'ok' : 'warn'}"><b>${t.validated}<small>/${t.rows}</small></b><span>${t.validated} de ${t.rows} dia(s) já validado(s)</span></div></div>
    ${(t.special || t.night) ? `<p class="small muted mine-extra">${t.special ? esc(fmtMin(t.special)) + ' em descanso ou feriado' : ''}${t.special && t.night ? ' · ' : ''}${t.night ? esc(fmtMin(t.night)) + ' à noite' : ''}</p>` : ''}
    <div class="card cal-card"><div class="sec-h" style="margin-top:0"><h2>Calendário</h2><span class="small muted">Toca num dia para ver tudo</span></div>
      ${mineCalendar(d)}
      <div class="cal-legend"><span><i class="ok"></i>validado</span><span><i class="todo"></i>por validar</span><span><i class="bad"></i>falta picagem</span><span><i class="off"></i>folga ou feriado</span></div></div>
    <div class="card">${d.days.map((r) => { const tz = r.tz || DEFAULT_TZ; return `<button class="day mday" data-day="${esc(r.date)}">
      <div class="day-h"><span class="d">${esc(dayLabel(r.date))}</span><span class="chip code">${esc(r.code)}</span>
        <span class="hrs">${esc(fmtMin(r.worked))}</span></div>
      <div class="per">${esc(fmtHour(r.first_in, tz) || '?')}–${esc(fmtHour(r.last_out, tz) || '?')} <span class="small muted">· ${esc(r.title)}</span></div>
      <div class="tags">${openNow(r) ? chip('val', 'a decorrer', 'clock') : r.anomalies.length ? chip('anom', 'falta uma picagem', 'warn') : DAY_STATUS[r.status] || chip('', r.status)}
        ${r.overtime ? chip('info', fmtMin(r.overtime) + ' extra' + (r.ot_ok === null ? ' (por aprovar)' : '')) : ''}${r.holiday ? chip('info', 'feriado') : r.rest ? chip('info', 'dia de descanso') : ''}
        ${r.changed ? chip('', 'corrigido', 'key') : ''}</div></button>`; }).join('')}</div>
    <p class="small muted">Se faltar um dia ou uma hora estiver errada, fala com o teu encarregado: ele corrige com o motivo, e tu vês aqui quem mudou e porquê.</p>`;
  el.querySelectorAll('[data-day]').forEach((b) => b.onclick = () => mineDay(b.dataset.day));
}
// Today: in since when, hours so far against a normal day, and the week as bars.
function mineHero(d) {
  const t = d.today || {}; const tz = (d.site && state.sites.find((s) => s.id === d.site.id) || {}).timezone || DEFAULT_TZ;
  const h = tzParts(Date.now(), tz).hour % 24;
  const hello = (h >= 6 && h < 13 ? 'Bom dia' : h >= 13 && h < 20 ? 'Boa tarde' : 'Boa noite') + ', ' + String(d.name || '').split(' ')[0];
  const inNow = t.last === 'in';
  let so = 0;
  for (let i = 0, open = null; i < (t.events || []).length; i++) {
    const e = t.events[i];
    if (e.dir === 'in') open = new Date(e.at).getTime();
    else if (open !== null) { so += (new Date(e.at).getTime() - open) / 60000; open = null; }
    if (i === t.events.length - 1 && open !== null) so += (Date.now() - open) / 60000;
  }
  so = Math.max(0, Math.round(so));
  const pct = Math.min(100, Math.round((so / (t.normal_day || 480)) * 100));
  const status = inNow ? `Na obra desde as <b>${esc(fmtHour(t.first_in, tz))}</b>`
    : t.last === 'out' ? `Saíste às <b>${esc(fmtHour(t.last_at, tz))}</b>` : 'Ainda não picaste hoje';
  const wk = d.week || []; const wmax = Math.max(600, ...wk.map((x) => x.worked)); const wsum = wk.reduce((a, x) => a + (x.date === t.date ? Math.max(x.worked, so) : x.worked), 0);
  const today = t.date;
  return `<section class="pic-hero mine-hero">
    <div class="pic-top"><h1>${esc(hello)}</h1>${inNow ? '<span class="live"><i></i>na obra</span>' : ''}</div>
    <div class="mh-now"><div class="mh-big">${esc(fmtMin(so))}</div><div class="mh-sub">${status}${d.site ? ` · ${esc(d.site.title)}` : ''}</div></div>
    <div class="mh-bar" role="img" aria-label="${pct}% de um dia normal"><i style="width:${pct}%"></i></div>
    <div class="mh-bl"><span>hoje</span><span>dia normal ${esc(fmtMin(t.normal_day || 480))}</span></div>
    <div class="mh-week"><div class="mh-wh"><span>Esta semana</span><b>${esc(fmtMin(wsum))}</b></div>
      <div class="mh-bars">${wk.map((x, i) => `<div class="${x.date === today ? 'today' : ''}"><i style="height:${(x.date === today ? Math.max(x.worked, so) : x.worked) ? Math.max(8, Math.round(((x.date === today ? Math.max(x.worked, so) : x.worked) / wmax) * 100)) : 0}%"></i><span>${['S', 'T', 'Q', 'Q', 'S', 'S', 'D'][i]}</span></div>`).join('')}</div></div>
  </section>`;
}
// What I will earn: only when the company switches it on. Gross, indicative, with the sums shown.
function minePay(d) {
  const p = d.pay; if (!p) return '';
  const mName = new Date(d.from + 'T12:00:00').toLocaleDateString('pt-PT', { month: 'long' });
  if (p.state === 'no_rate') return `<div class="card pay"><h2 style="margin-top:0">Quanto vou ganhar</h2><p class="small muted">A empresa ainda não registou o teu valor à hora. Pede ao escritório.</p></div>`;
  const row = (label, v, sub) => Number(v) ? `<div class="pay-r"><span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><b>${esc(euro(v))}</b></div>` : '';
  const conf = Number(p.total) ? Math.round((Number(p.confirmed) / Number(p.total)) * 100) : 0;
  return `<div class="card pay"><div class="pay-h"><span>Quanto vou ganhar em ${esc(mName)}</span>${chip('', 'estimativa')}</div>
    <div class="pay-big">${esc(euro(p.total))}</div>
    <div class="pay-conf"><i style="width:${conf}%"></i></div>
    <p class="small muted" style="margin:6px 0 12px">${esc(euro(p.confirmed))} já confirmados pelo encarregado ou pelo escritório</p>
    ${row('Horas normais', p.normal, euro(p.rate) + ' à hora')}
    ${row('Horas extra aprovadas', p.overtime, p.own_ot_rate ? 'valor da empresa' : '1.ª hora +25 %, seguintes +37,5 %')}
    ${row('Descanso e feriados', p.special, '+50 %')}
    ${row('Noite', p.night, 'acréscimo')}
    ${row('Diárias', p.per_diems, 'emitidas para pagamento')}
    ${Number(p.overtime_pending) ? `<div class="pay-r pend"><span>Horas extra por aprovar<small>entram quando forem aprovadas</small></span><b>+${esc(euro(p.overtime_pending))}</b></div>` : ''}
    ${more('Como faço estas contas', '<p>As tuas horas oficiais (as do cartão) vezes o teu valor à hora. Horas extra com as regras de Portugal (Código do Trabalho, art. 268.º): +25 % na 1.ª hora do dia, +37,5 % nas seguintes, +50 % em descanso ou feriado, e mais acima das 100 horas do ano.</p><p>É um valor <b>bruto e indicativo</b>: não tira IRS nem Segurança Social, e o contrato coletivo pode ter outras regras. O recibo de vencimento é o que conta.</p>')}</div>`;
}
// The site: where it is, a button to the map, and who to call.
function mineSite(s) {
  if (!s) return '';
  const q = s.lat && s.lng ? `${s.lat},${s.lng}` : [s.address, s.municipality].filter(Boolean).join(', ');
  const map = q ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}` : '';
  const tel = (n) => `tel:${String(n).replace(/[^\d+]/g, '')}`;
  const who = (name, role, phone) => name ? `<div class="contact">${avatar(name)}<div class="grow"><b>${esc(name)}</b><small>${esc(role)}</small></div>
      ${phone ? `<a class="btn ghost small" href="${esc(tel(phone))}">${ic('phone')}Ligar</a>` : ''}</div>` : '';
  return `<div class="card site-card"><p class="eyebrow" style="margin-top:0">A minha obra</p>
    <h2 style="margin:0">${esc(s.title)}</h2><p class="small muted" style="margin:2px 0 10px">${esc([s.code, s.client].filter(Boolean).join(' · '))}</p>
    ${q ? `<p class="addr">${ic('pin')}<span>${esc([s.address, s.municipality].filter(Boolean).join(', ') || 'Localização no mapa')}</span></p>
      <a class="btn wide" href="${esc(map)}" target="_blank" rel="noopener">${ic('go')}Levar-me lá</a>` : '<p class="small muted">A morada da obra ainda não foi preenchida.</p>'}
    ${who(s.supervisor, 'Encarregado', s.supervisor_phone)}${who(s.contact_name, s.contact_role || 'Contacto do cliente', s.contact_phone)}</div>`;
}
// One day in full: every tap (and who added it by hand, and why) and every step of the validation.
async function mineDay(day) {
  const { data: d, error } = await sb.rpc('mini_my_day', { p_day: day });
  if (error) return toast(friendly(error));
  const r = ((state.mineData && state.mineData.days) || []).find((x) => x.date === day);
  const body = `<div class="mday-sum">${r ? `<b>${esc(fmtMin(r.worked))}</b> trabalhadas${r.overtime ? ` · ${esc(fmtMin(r.overtime))} extra` : ''}` : ''}</div>
    <h3>Picagens</h3>${d.events.length ? `<ol class="taps">${d.events.map((e) => `<li><span class="t">${esc(fmtHour(e.at, e.tz))}</span>
      <span>${e.dir === 'in' ? 'Entrada' : 'Saída'} · ${esc(e.code)}${e.manual ? `<small class="warn-t">${ic('key')}Adicionada à mão: ${esc(e.reason || '')}</small>` : ''}</span></li>`).join('')}</ol>` : '<p class="small muted">Sem picagens neste dia.</p>'}
    <h3>Validação</h3><ol class="steps">${(r ? [`<li class="on"><b>Registado</b><small>pelas picagens do cartão</small></li>`] : []).join('')}
      ${d.log.map((l) => `<li class="on ${l.to === 'registered' ? 'back' : ''}"><b>${esc(l.to === 'registered' ? 'Devolvido para corrigir' : MINE_STATE[l.to] || l.to)}</b>
        <small>${esc(l.by || '')} · ${esc(new Date(l.at).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</small>
        ${l.note ? `<small class="note-t">«${esc(l.note)}»</small>` : ''}</li>`).join('')}
      ${r && r.status === 'registered' ? '<li><b>À espera do encarregado</b></li>' : ''}</ol>`;
  const { data: disp } = await sb.rpc('mini_my_day_disputes', { p_day: day });
  const open = (disp || []).some((x) => x.status === 'open');
  const canDispute = r && r.status !== 'sent_to_payroll' && !open;
  const dispHtml = (disp || []).length ? `<h3>As minhas reclamações</h3>${disp.map(dispLine).join('')}` : '';
  const fd = await askSheet(dayLabel(day), body + dispHtml + (canDispute ? '<button class="btn ghost wide disagree" value="dispute" formnovalidate>Não concordo com este dia</button>' : ''), 'Fechar');
  if (!fd || fd.get('_v') !== 'dispute') return;
  const f2 = await askSheet('Não concordo: ' + dayLabel(day), `<p class="small muted">O encarregado ou o escritório respondem antes de fechar o mês. Vês a resposta aqui.</p>
      <div class="chips reasons" role="radiogroup">${Object.entries(DISPUTE_REASON).map(([k, v], i) => `<label class="chip"><input type="radio" name="reason" value="${k}" ${i === 0 ? 'checked' : ''}>${esc(v)}</label>`).join('')}</div>
      <label for="dnote">Explica (obrigatório em «Outro motivo»)</label><textarea id="dnote" name="note" rows="3" maxlength="500" placeholder="ex.: entrei às 06:45, o cartão não leu"></textarea>`, 'Enviar');
  if (!f2) return;
  const { error: e } = await sb.rpc('mini_dispute_day', { p_day: day, p_reason: f2.get('reason'), p_note: String(f2.get('note') || '').trim() || null });
  if (e) return toast(friendly(e));
  toast('Enviado. O encarregado e o escritório vão responder antes de fechar o mês.');
  loadMyRequests(); loadMine();
}
const DISPUTE_REASON = { earlier_in: 'Entrei mais cedo', later_out: 'Saí mais tarde', missing_overtime: 'Faltam horas extra', was_present: 'Estive lá e diz que faltei', other: 'Outro motivo' };
const ABS_KIND = { vacation: 'Férias', medical_appointment: 'Consulta médica', justified_paid: 'Falta justificada', justified_unpaid: 'Falta sem vencimento',
  bereavement: 'Falecimento de familiar', marriage: 'Casamento' };
const dispLine = (x) => `<div class="req ${x.status}"><div class="req-h"><b>${esc(DISPUTE_REASON[x.reason] || x.reason)}</b>${x.day ? `<span class="small muted">${esc(dayLabel(x.day))}</span>` : ''}
    ${x.status === 'open' ? chip('reg', 'à espera de resposta', 'clock') : x.status === 'fixed' ? chip('val', 'corrigido', 'ok') : chip('', 'mantido')}</div>
  ${x.note ? `<p class="small">«${esc(x.note)}»</p>` : ''}${x.answer ? `<p class="small ans">${ic('user')}<span><b>${esc(x.by || 'Resposta')}:</b> ${esc(x.answer)}</span></p>` : ''}</div>`;
const absWhen = (a) => a.from === a.to ? `${fmtDate(a.from)}${a.minutes ? ` · ${fmtMin(a.minutes)}` : ''}` : `${fmtDate(a.from)} a ${fmtDate(a.to)}`;
function absSteps(a) {
  const st = a.status;
  const sup = a.sup_ok === true ? `<li class="on"><b>Encarregado: de acordo</b>${a.sup_note ? `<small>«${esc(a.sup_note)}»</small>` : ''}</li>`
    : a.sup_ok === false ? `<li class="on back"><b>Encarregado: recusou</b>${a.sup_note ? `<small>«${esc(a.sup_note)}»</small>` : ''}</li>`
    : st === 'requested' ? '<li><b>À espera do encarregado</b></li>' : '';
  const off = st === 'approved' ? `<li class="on"><b>Escritório: aprovado</b>${a.decision_note ? `<small>«${esc(a.decision_note)}»</small>` : ''}</li>`
    : st === 'rejected' && a.sup_ok !== false ? `<li class="on back"><b>Escritório: recusado</b>${a.decision_note ? `<small>«${esc(a.decision_note)}»</small>` : ''}</li>`
    : st === 'requested' && a.sup_ok ? '<li><b>À espera do escritório</b></li>' : st === 'cancelled' ? '<li class="on"><b>Cancelado por ti</b></li>' : '';
  return `<ol class="steps"><li class="on"><b>Pedido enviado</b><small>${esc(new Date(a.at).toLocaleDateString('pt-PT'))}</small></li>${sup}${off}</ol>`;
}
const ABS_CHIP = { requested: chip('reg', 'pendente', 'clock'), approved: chip('val', 'aprovado', 'ok'), rejected: chip('anom', 'recusado'), cancelled: chip('', 'cancelado') };
// The worker's requests: holiday balance, ask for holidays / an absence / leaving early, and the answers.
async function loadMyRequests() {
  const box = $('#minereq'); if (!box) return;
  const { data: d, error } = await sb.rpc('mini_my_requests');
  if (!box.isConnected) return;
  if (error) { box.innerHTML = ''; return; }
  const b = d.balance;
  box.innerHTML = `<div class="card reqs"><div class="sec-h" style="margin-top:0"><h2>Pedidos</h2></div>
    ${b ? `<div class="vac"><div class="vac-n"><b>${b.remaining}</b><span>dias de férias por marcar em ${b.year}</span></div><small>${b.entitled} por ano · ${b.used} gozados${b.pending ? ` · ${b.pending} em pedido` : ''}</small></div>` : ''}
    <div class="acts"><button class="btn" id="askvac">${ic('calendar')}Pedir férias</button><button class="btn ghost" id="askabs">${ic('clock')}Pedir falta</button></div>
    ${d.absences.length ? `<h3>Os meus pedidos</h3>${d.absences.map((a) => `<details class="req"><summary><span class="req-h"><b>${esc(ABS_KIND[a.kind] || a.kind)}</b>
        <span class="small muted">${esc(absWhen(a))}</span>${ABS_CHIP[a.status] || ''}</span></summary>
        ${a.note ? `<p class="small">«${esc(a.note)}»</p>` : ''}${absSteps(a)}
        ${a.status === 'requested' ? `<button class="btn ghost small" data-cancel="${esc(a.id)}">Cancelar o pedido</button>` : ''}</details>`).join('')}` : ''}
    ${d.disputes.length ? `<h3>As minhas reclamações</h3>${d.disputes.map(dispLine).join('')}` : ''}<div id="glances"></div></div>`;
  sb.rpc('mini_my_glances').then(({ data: gl }) => { const el = $('#glances'); if (!el || !gl || !gl.length) return;
    el.innerHTML = `<details class="req"><summary><span class="req-h"><b>Quem viu as minhas horas pelo cartão</b><span class="small muted">${gl.length}</span></span></summary>
      ${gl.map((x) => `<p class="small">${esc(x.by || '')} · ${esc(new Date(x.at).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</p>`).join('')}</details>`; });
  $('#askvac').onclick = () => askAbsence('vacation');
  $('#askabs').onclick = () => askAbsence(null);
  box.querySelectorAll('[data-cancel]').forEach((x) => x.onclick = async () => {
    const { error: e } = await sb.rpc('mini_cancel_my_absence', { p_id: x.dataset.cancel });
    if (e) return toast(friendly(e)); toast('Pedido cancelado.'); loadMyRequests();
  });
}
async function askAbsence(kind) {
  const today = isoDay(new Date());
  const kinds = kind ? '' : `<label>O quê</label><div class="chips reasons" role="radiogroup">${Object.entries(ABS_KIND).filter(([k]) => k !== 'vacation').map(([k, v], i) =>
    `<label class="chip"><input type="radio" name="kind" value="${k}" ${i === 0 ? 'checked' : ''}>${esc(v)}</label>`).join('')}</div>`;
  const fd = await askSheet(kind ? 'Pedir férias' : 'Pedir falta ou sair mais cedo', `${kinds}
    <div class="two"><div><label for="af">${kind ? 'Do dia' : 'Dia'}</label><input type="date" id="af" name="from" value="${today}" min="${today}" required></div>
    <div><label for="at">Até ao dia</label><input type="date" id="at" name="to" value="${today}" min="${today}" required></div></div>
    ${kind ? '' : `<label class="check inline"><input type="checkbox" name="part" id="apart"> Só umas horas desse dia (ex.: saio à tarde)</label>
      <div id="ahrs" hidden><label for="ah">Quantas horas fora</label><select id="ah" name="hours">${[1, 2, 3, 4, 5, 6].map((h) => `<option value="${h * 60}" ${h === 4 ? 'selected' : ''}>${h} h</option>`).join('')}</select></div>`}
    <label for="an">${kind ? 'Nota (opcional)' : 'Porquê'}</label><textarea id="an" name="note" rows="2" maxlength="500" ${kind ? '' : 'required minlength="5"'}></textarea>
    <p class="small muted">Vai primeiro ao teu encarregado e depois ao escritório. Vês aqui cada resposta.</p>`, 'Enviar pedido', (dlg) => {
    const f = dlg.querySelector('#af'); const t = dlg.querySelector('#at');
    f.onchange = () => { if (t.value < f.value) t.value = f.value; t.min = f.value; };
    const pt = dlg.querySelector('#apart'); if (pt) pt.onchange = () => { dlg.querySelector('#ahrs').hidden = !pt.checked; if (pt.checked) t.value = f.value; t.disabled = pt.checked; };
  });
  if (!fd) return;
  const from = fd.get('from'); const part = !!fd.get('part');
  const { error } = await sb.rpc('mini_request_absence', { p_kind: kind || fd.get('kind'), p_starts: from, p_ends: part ? from : (fd.get('to') || from),
    p_minutes: part ? Number(fd.get('hours')) : null, p_note: String(fd.get('note') || '').trim() || null });
  if (error) return toast(friendly(error));
  toast('Pedido enviado ao teu encarregado.');
  loadMyRequests();
}
// The month as a calendar: each day coloured by its state. Monday first.
function mineCalendar(d) {
  const from = new Date(d.from + 'T12:00:00'); const lead = (from.getDay() + 6) % 7;
  const last = Number(d.to.slice(8, 10)); const today = (d.today || {}).date;
  const by = {}; for (const r of d.days) { const x = by[r.date] || (by[r.date] = { w: 0, k: [] }); x.w += r.worked; x.k.push(r); }
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="cd pad"></span>');
  for (let n = 1; n <= last; n++) {
    const iso = d.from.slice(0, 8) + String(n).padStart(2, '0'); const x = by[iso];
    const wd = (lead + n - 1) % 7;
    const k = !x ? (wd >= 5 ? 'off' : '') : x.k.some((r) => r.anomalies.length && !(r.anomalies.every((a) => a === 'open_shift') && iso >= today)) ? 'bad' : x.k.some((r) => r.holiday || r.rest) && x.w ? 'off' : x.k.every((r) => r.status !== 'registered') ? 'ok' : 'todo';
    cells.push(x ? `<button class="cd ${k}${iso === today ? ' today' : ''}" data-day="${iso}"><b>${n}</b><small>${esc(fmtMin(x.w).replace('h00', 'h'))}</small></button>`
      : `<span class="cd ${k}${iso === today ? ' today' : ''}"><b>${n}</b></span>`);
  }
  return `<div class="cal-h">${['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((x) => `<span>${x}</span>`).join('')}</div><div class="cal">${cells.join('')}</div>`;
}

// ------------------------------------------------------------------ Diárias (paid in advance on Thursday, for the week)
// The office issues the week; the team leader decides each missed or short day (deduct, or justified); the deduction
// comes off the next diária or, if the month closes first, off the salary. The worker sees every step in As minhas horas.
// The last state is "emitida para pagamento": the app never knows whether the money reached the account.
const euro = (v) => (v == null ? '–' : `${Number(v).toFixed(2).replace('.', ',')} €`);
const canPdCases = () => can('diarias.decidir_faltas');
const PD_PROBLEM = { site_without_amount: 'obra sem valor de diária: põe-no em Obras', site_pays_none: 'esta obra não paga diária',
  no_days: 'sem dias para pagar nesta semana' };
const PD_CASE = { to_decide: chip('warn', 'por decidir', 'warn'), deduct: chip('anom', 'a descontar'), excused: chip('ok', 'justificada', 'ok') };
// A rest day abroad follows the working day around it: 'rest:<day>' names it (missed the day before, or did not come back).
const pdRestOf = (c) => (String(c.kind).startsWith('rest:') ? c.kind.slice(5) : null);
const pdKind = (c) => { const r = pdRestOf(c);
  if (r) return r < c.day ? `dia de descanso, faltou ${dayLabel(r)}` : `dia de descanso, não voltou ${dayLabel(r)}`;
  return c.kind === 'absent' ? 'faltou' : `só ${fmtMin(c.worked_minutes ?? c.minutes)}`; };
const pdDays = (days) => (days || []).map((d) => dayLabel(d)).join(' · ');
let pdSeq = 0;
async function loadPerDiems() {
  const box = $('#pdbody'); if (!box) return;
  if (!state.pdWeek) state.pdWeek = monday(new Date());
  const week = isoDay(state.pdWeek); const end = new Date(state.pdWeek); end.setDate(end.getDate() + 6);
  const short = (d) => d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
  const thu = new Date(state.pdWeek); thu.setDate(thu.getDate() + 3);
  const future = state.pdWeek > new Date();
  box.innerHTML = `<div class="row" style="margin:4px 0;flex-wrap:nowrap;align-items:center">
      <button class="btn ghost small" id="pdprev" style="flex:0 0 auto" aria-label="Semana anterior">‹</button>
      <div style="text-align:center;flex:1 1 auto"><b>${esc(short(state.pdWeek))} – ${esc(short(end))}</b><div class="small muted">paga na quinta ${esc(short(thu))}</div></div>
      <button class="btn ghost small" id="pdnext" style="flex:0 0 auto" aria-label="Semana seguinte">›</button></div>
    <div id="pdlist">${skel(2)}</div>`;
  $('#pdprev').onclick = () => { state.pdWeek.setDate(state.pdWeek.getDate() - 7); loadPerDiems(); };
  $('#pdnext').onclick = () => { state.pdWeek.setDate(state.pdWeek.getDate() + 7); loadPerDiems(); };
  const seq = ++pdSeq;
  const { data, error } = future ? { data: [] } : await sb.rpc('mini_per_diem_preview', { p_week: week });
  const el = $('#pdlist'); if (!el || seq !== pdSeq) return;
  if (error) { el.innerHTML = `<p>${esc(friendly(error))}</p>`; return; }
  if (!data.length) { el.innerHTML = `<p class="muted">${future ? 'Esta semana ainda não começou.' : 'Ninguém picou nesta semana: não há diárias.'}</p>`; return; }
  const todo = data.filter((r) => !r.issued && !r.problem);
  const issued = data.filter((r) => r.issued);
  const sum = (rows, k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
  el.innerHTML = `<div class="kpis"><div class="kpi ${todo.length ? 'hot' : ''}"><b>${todo.length}</b><span>por emitir · ${esc(euro(sum(todo, 'net_amount')))}</span></div>
      <div class="kpi ok"><b>${issued.length}</b><span>emitidas · ${esc(euro(sum(issued, 'net_amount')))}</span></div>
      <div class="kpi ${data.length - todo.length - issued.length ? 'warn' : ''}"><b>${data.length - todo.length - issued.length}</b><span>sem diária</span></div></div>
    ${data.map((r) => `<div class="day"><div class="day-h">
        ${!r.issued && !r.problem ? `<input type="checkbox" class="pdck" value="${esc(r.collaborator_id)}" checked aria-label="Pagar a ${esc(r.full_name)}">` : ''}
        <span class="d">${esc(r.full_name)}</span><span class="chip code">${esc(r.project_code)}</span>${flag(r.country, '')}
        <span class="hrs">${r.problem ? '–' : esc(euro(r.net_amount))}</span></div>
      ${r.problem ? `<div class="tags">${chip(r.problem === 'site_without_amount' ? 'warn' : '', PD_PROBLEM[r.problem] || r.problem)}</div>`
        : `<div class="per small">${(r.days || []).length} dia(s) × ${esc(euro(r.unit_amount))} = ${esc(euro(r.gross_amount))}${Number(r.deduction_amount) ? ` − ${esc(euro(r.deduction_amount))} de faltas` : ''}
          <br><span class="muted">${esc(pdDays(r.days))}</span></div>
        <div class="tags">${r.issued ? chip('ok', 'emitida para pagamento ' + new Date(r.issued_at).toLocaleDateString('pt-PT'), 'ok') : ''}
          ${!r.issued && Number(r.pending_deduction) > Number(r.deduction_amount) ? chip('warn', `${euro(Number(r.pending_deduction) - Number(r.deduction_amount))} a descontar fica para depois`) : ''}</div>`}</div>`).join('')}
    <div class="acts">${todo.length ? `<button class="btn big acc" id="pdissue">${ic('ok')}Emitir para pagamento</button>` : ''}
      <button class="btn ghost wide" id="pdxl">Excel das diárias da semana</button></div>
    ${more('Como se calcula', `<p>Em Portugal paga-se de segunda a sexta; no estrangeiro de segunda a domingo. Conta a partir do primeiro dia em que a pessoa picou na semana.
      Os dias que já passaram só contam se a pessoa esteve na obra (no estrangeiro, os dias de descanso contam). Hoje e os dias à frente contam adiantados.</p>
      <p>Se depois faltar, ou fizer menos horas que o mínimo, o encarregado decide: desconta ou fica justificada. O desconto sai da diária seguinte; se o mês fechar antes, sai do ordenado.</p>`)}`;
  const btn = $('#pdissue');
  const picked = () => [...el.querySelectorAll('.pdck:checked')].map((c) => c.value);
  const label = () => { if (!btn) return; const ids = picked(); const t = sum(todo.filter((r) => ids.includes(r.collaborator_id)), 'net_amount');
    btn.lastChild.textContent = `Emitir ${ids.length} diária(s) para pagamento · ${euro(t)}`; btn.disabled = !ids.length; };
  el.querySelectorAll('.pdck').forEach((c) => c.onchange = label); label();
  if (btn) btn.onclick = async () => {
    const ids = picked(); if (!ids.length) return;
    const t = sum(todo.filter((r) => ids.includes(r.collaborator_id)), 'net_amount');
    const fd = await askSheet('Emitir diárias para pagamento', `<p>${ids.length} pessoa(s), ${esc(euro(t))} no total.</p>
      <p class="small muted">Cada pessoa recebe o aviso «emitida para pagamento» com as contas. Depois de emitida, a diária não muda: uma falta a seguir desconta-se na próxima.</p>`, 'Emitir');
    if (!fd) return;
    const { data: n, error: e2 } = await sb.rpc('mini_per_diem_issue', { p_week: week, p_collabs: ids });
    if (e2) return toast(friendly(e2));
    toast(`${n} diária(s) emitida(s) para pagamento.`); loadPerDiems();
  };
  $('#pdxl').onclick = () => downloadPerDiems(week, data);
}
function downloadPerDiems(week, data) {
  const end = new Date(week + 'T12:00:00'); end.setDate(end.getDate() + 6);
  excelExport(async () => data, (X, rows) => {
    const open = rows.some((r) => !r.issued && !r.problem);
    const doc = xlDoc([], 'Diárias da semana', `Semana de ${fmtDate(week)} a ${fmtDate(isoDay(end))}`, null);
    const wb = xlBook(X, doc);
    const t = xlSheet(wb, 'Diárias', doc, [{ h: 'Nº', t: 'text', w: 8, max: 14 }, { h: 'Nome', t: 'text', w: 20, max: 38 },
      { h: 'Obra', t: 'text', w: 8, max: 14 }, { h: 'País', t: 'text', w: 6 }, { h: 'Dias', t: 'n', w: 6 }, { h: 'Dias pagos', t: 'text', w: 20, max: 60 },
      { h: 'Valor por dia', t: 'eur', w: 10 }, { h: 'Bruto', t: 'eur', w: 10 }, { h: 'Desconto de faltas', t: 'eur', w: 11 },
      { h: 'A pagar', t: 'eur', w: 11, font: { bold: true } }, { h: 'Estado', t: 'text', w: 14, max: 40 }]);
    const first = t.head + 1; let r = first; const s = [0, 0, 0];
    for (const x of rows) {
      const p = !!x.problem;
      xlRow(t, r, [x.employee_number, x.full_name, x.project_code, COUNTRY[x.country] || x.country, p ? 0 : (x.days || []).length,
        p ? '' : (x.days || []).map((d) => d.slice(8, 10) + '/' + d.slice(5, 7)).join(', '), p ? null : Number(x.unit_amount),
        p ? 0 : Number(x.gross_amount), p ? 0 : Number(x.deduction_amount), p ? 0 : Number(x.net_amount),
        x.issued ? 'Emitida para pagamento' : p ? PD_PROBLEM[x.problem] : 'Por emitir'],
      { cell: x.issued ? { 10: { font: { color: { argb: XL.ok } } } } : p ? {} : { 10: { fill: XL.warnBg, font: { color: { argb: XL.warn } } } } });
      if (!p) { s[0] += Number(x.gross_amount); s[1] += Number(x.deduction_amount); s[2] += Number(x.net_amount); }
      r++;
    }
    const last = r - 1;
    xlRow(t, r, [null, `Total (${rows.length})`, null, null, null, null, null, xlSum(t, 7, first, last, s[0]), xlSum(t, 8, first, last, s[1]),
      xlSum(t, 9, first, last, s[2]), null], { bold: true, fill: XL.soft, top: true, height: 18 });
    xlFit(t, first, last);
    xlNote(t.ws, r + 2, 'Em Portugal paga-se de segunda a sexta; no estrangeiro de segunda a domingo. Faltas depois de emitida descontam-se na diária seguinte ou no ordenado.');
    return { wb, name: `gestnow-diarias-${week}.xlsx`, msg: open ? 'Excel descarregado: ainda há diárias por emitir.' : 'Excel descarregado.' };
  });
}
async function showPerDiemSettings() {
  const box = $('#pdform'); if (!box) return;
  const { data: s, error } = await sb.rpc('mini_per_diem_settings');
  if (!box.isConnected) return;
  if (error) { box.innerHTML = `<p>${esc(friendly(error))}</p>`; return; }
  const v = (x) => (x == null ? '' : Number(x).toFixed(2));
  box.innerHTML = `<form id="pdset"><div class="row"><div><label for="pdpt">Diária em Portugal (€)</label><input id="pdpt" name="pt" type="number" min="0" max="1000" step="0.01" inputmode="decimal" value="${v(s.amount_pt)}" placeholder="ex.: 12,50"></div>
      <div><label for="pdab">Diária no estrangeiro (€)</label><input id="pdab" name="ab" type="number" min="0" max="1000" step="0.01" inputmode="decimal" value="${v(s.amount_abroad)}" placeholder="ex.: 25,00"></div></div>
    <label for="pdmin">Mínimo de horas no dia para ter diária</label><input id="pdmin" name="min" type="number" min="0" max="12" step="0.5" inputmode="decimal" value="${(s.min_minutes ?? 240) / 60}">
    <p class="small muted">Menos que isto, o encarregado decide: desconta, ou fica justificada. 0 = só conta faltar o dia todo.</p>
    <label for="pdrule">Regra da empresa (os trabalhadores leem isto)</label>
    <textarea id="pdrule" name="rule" rows="4" maxlength="2000" placeholder="ex.: Quem trabalhar menos de 4 horas não recebe a diária desse dia, a não ser que o encarregado aceite a justificação.">${esc(s.rule_text || '')}</textarea>
    <p class="small muted">Cada obra pode ter um valor próprio, ou não pagar: muda-o em Obras.</p>
    <p><button class="btn wide">Guardar</button></p></form>`;
  $('#pdset').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const num = (k) => (String(f.get(k) || '').trim() === '' ? null : Number(String(f.get(k)).replace(',', '.')));
    const { error: e2 } = await sb.rpc('mini_set_per_diem_settings', { p_amount_pt: num('pt'), p_amount_abroad: num('ab'),
      p_min_minutes: Math.round((num('min') ?? 4) * 60), p_rule_text: String(f.get('rule') || '') });
    if (e2) return toast(friendly(e2));
    toast('Diárias guardadas.'); loadPerDiems();
  };
}
// The cases: a paid day the person missed, or worked less than the minimum. One tap to deduct; "justificada" asks why.
async function loadPdCases(boxSel, project) {
  const box = $(boxSel); if (!box || !canPdCases()) return;
  const { data, error } = await sb.rpc('mini_per_diem_cases', { p_project: project || null });
  if (!box.isConnected) return;
  if (error) { box.innerHTML = `<p class="small">${esc(friendly(error))}</p>`; return; }
  const card = box.closest('[data-pdcases]');
  const open = data.filter((c) => c.status === 'to_decide');
  if (card && card.dataset.pdcases === 'auto') card.hidden = !data.length;
  if (!data.length) { box.innerHTML = '<p class="muted small" style="margin:0">Nenhuma falta nas diárias pagas.</p>'; return; }
  // A rest day whose working day is also waiting is decided with it: no buttons of its own.
  const follows = (c) => { const r = pdRestOf(c); return r && open.some((o) => o.collaborator_id === c.collaborator_id && o.day === r && !pdRestOf(o)); };
  box.innerHTML = `${open.length ? `<p class="small" style="margin-top:0"><b>${open.length} por decidir.</b> A diária destes dias já foi paga.
      No estrangeiro, quem falta ao dia de trabalho antes do descanso, ou não volta depois, perde também os dias de descanso. Baixa médica desconta: quem paga é o seguro.</p>` : ''}
    ${data.map((c) => `<div class="day"><div class="day-h"><span class="d">${esc(c.full_name)}</span><span class="chip code">${esc(c.project_code)}</span>
      <span class="hrs">${esc(euro(c.amount))}</span></div>
      <div class="per">${esc(dayLabel(c.day))}: ${esc(pdKind(c))}${c.reason ? ` · <span class="muted">${esc(c.reason)}</span>` : ''}</div>
      <div class="tags">${PD_CASE[c.status] || chip('', c.status)}${c.settled ? chip('', 'descontado: ' + c.settled) : ''}${c.decided_by_name ? chip('', c.decided_by_name) : ''}</div>
      ${c.status === 'to_decide' && follows(c) ? `<p class="small muted" style="margin:6px 0 0">Decide-se com ${esc(dayLabel(pdRestOf(c)))}.</p>` : ''}
      ${c.status === 'to_decide' && !c.is_me && !follows(c) ? `<div class="acts"><button class="btn small" data-pdded="${esc(c.case_id)}">Descontar ${esc(euro(c.amount))}</button>
        <button class="btn ghost small" data-pdok="${esc(c.case_id)}" data-name="${esc(c.full_name)}">Justificada</button></div>` : ''}</div>`).join('')}`;
  const decide = async (id, deduct, reason) => {
    const { error: e2 } = await sb.rpc('mini_per_diem_decide', { p_case: id, p_deduct: deduct, p_reason: reason || null });
    if (e2) return toast(friendly(e2));
    toast(deduct ? 'Fica a descontar. A pessoa recebe o aviso.' : 'Justificada: não há desconto. A pessoa recebe o aviso.');
    loadPdCases(boxSel, project);
  };
  box.querySelectorAll('[data-pdded]').forEach((b) => b.onclick = () => decide(b.dataset.pdded, true));
  box.querySelectorAll('[data-pdok]').forEach((b) => b.onclick = async () => {
    const fd = await askSheet(`Diária de ${b.dataset.name}: justificada`, `<label for="pdwhy">Porquê? *</label>
      <input id="pdwhy" name="why" required minlength="5" maxlength="300" autofocus placeholder="ex.: foi ao médico, avisou antes">
      <p class="small muted">A pessoa recebe a diária inteira deste dia (e dos dias de descanso que dependem dele). Fica escrito com o teu nome. Baixa médica não se justifica aqui: desconta, quem paga é o seguro.</p>`, 'Aceitar justificação');
    if (fd) decide(b.dataset.pdok, false, String(fd.get('why') || '').trim());
  });
}
// The worker's own diárias, on top of As minhas horas: new notices first, then the weeks and the days with a deduction.
async function loadMyPerDiems() {
  const box = $('#pdmine'); if (!box) return;
  const { data: d, error } = await sb.rpc('mini_my_per_diems');
  if (!box.isConnected) return;
  if (error || (!d.weeks.length && !d.cases.length && !d.notices.length)) { box.innerHTML = ''; return; }
  const fresh = d.notices.filter((n) => n.new);
  const NOTE_ICON = { issued: 'ok', to_deduct: 'warn', excused: 'ok', deducted_week: 'warn', deducted_salary: 'warn' };
  box.innerHTML = `<div class="card"><h2 style="margin-top:0">As minhas diárias</h2>
    ${d.notices.slice(0, fresh.length || 3).map((n) => `<div class="note pd ${n.new ? 'new' : ''}">${ic(NOTE_ICON[n.kind] || 'clock')}<span>${esc(n.title)}
      <span class="small muted">· ${esc(new Date(n.at).toLocaleDateString('pt-PT'))}</span>${n.new ? ' ' + chip('info', 'novo') : ''}</span></div>`).join('')}
    ${d.weeks.slice(0, 4).map((w) => `<div class="day"><div class="day-h"><span class="d">Semana de ${esc(fmtDate(w.week_start).slice(0, 5))}</span>
        <span class="chip code">${esc(w.site)}</span><span class="hrs">${esc(euro(w.net))}</span></div>
      <div class="per small">${w.days.length} dia(s) × ${esc(euro(w.unit))}${Number(w.deduction) ? ` − ${esc(euro(w.deduction))} de faltas` : ''} · emitida para pagamento ${esc(new Date(w.issued_at).toLocaleDateString('pt-PT'))}</div></div>`).join('')}
    ${d.cases.length ? `<h3>Dias com desconto ou por decidir</h3>${d.cases.map((c) => `<div class="day"><div class="day-h"><span class="d">${esc(dayLabel(c.day))}</span>
        <span class="small">${esc(pdKind(c))}</span><span class="hrs">${esc(euro(c.amount))}</span></div>
      <div class="tags">${c.status === 'to_decide' ? chip('warn', 'o encarregado vai decidir') : PD_CASE[c.status] || ''}${c.settled ? chip('', 'descontado: ' + c.settled) : ''}</div>
      ${c.reason ? `<div class="per small muted">${esc(c.reason)}</div>` : ''}</div>`).join('')}` : ''}
    ${more('Regra das diárias', `<p>${esc(d.rule_text || `Menos de ${fmtMin(d.min_minutes)} de trabalho num dia, ou faltar, só dá diária se o encarregado aceitar a justificação.`)}</p>
      <p>A diária é paga adiantada. Se faltares depois, desconta-se na próxima; se o mês fechar antes, desconta-se no ordenado. «Emitida para pagamento» quer dizer que o escritório a mandou pagar.</p>`)}</div>`;
  if (fresh.length) sb.rpc('mini_per_diem_seen').then(() => {}, () => {});
}

// ------------------------------------------------------------------ Secretariado (RH): todas as obras, aprovar, fechar o mês
// The site validates, the office approves or sends a day back, and closes the month for payroll.
// After closing, nobody can change those days (the database refuses).
const OFFICE_STATUS = { registered: chip('reg', 'na obra: por validar'), supervisor_validated: chip('val', 'validado na obra', 'ok'),
  hr_validated: chip('apr', 'aprovado', 'ok'), sent_to_payroll: chip('fech', 'fechado: salários') };
function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  return { from: `${ym}-01`, to: isoDay(new Date(y, m, 0, 12)) };
}
function viewOffice() {
  if (!canOffice()) return viewClock();   // code guard as well as the database's
  if (!state.officeMonth) state.officeMonth = isoDay(new Date()).slice(0, 7);
  const { from, to } = monthRange(state.officeMonth);
  const sites = state.sites;
  const main = `<div class="ph"><div><p class="ph-k">Escritório · todas as obras</p><h1>Secretariado</h1></div>
    <div class="monthnav noprint"><button class="iconbtn" id="mprev" aria-label="Mês anterior">‹</button><label for="month">Mês</label><input type="month" id="month" value="${esc(state.officeMonth)}"><button class="iconbtn" id="mnext" aria-label="Mês seguinte">›</button></div></div>
    <div class="noprint">
      ${can('horas.aprovar') ? `<p class="small muted">A obra valida, tu aprovas, no fim do mês fechas.</p>
      ${more('Em que reparar', '<p>Olha com atenção para as picagens marcadas «à mão», «sem rede, chegou tarde» e «próprio cartão»: aparecem a amarelo no dia.</p>')}
      <div id="sum">${skel(1)}</div>` : ''}</div>
    ${can('horas.aprovar') ? `<div id="list">${skel(3)}</div>` : ''}`;
  const side = `${can('horas.aprovar') ? '<div id="offreq" class="noprint"></div>' : ''}${can('salarios.exportar') ? `<div class="card noprint"><h2 style="margin-top:0">Salários</h2>
      <p class="small muted">Folha Excel do mês e ficheiro para o Primavera.</p>
      ${more('O que leva a folha', '<p>Uma linha por pessoa e obra, com as horas normais, as extra aprovadas, as noturnas e as de descanso ou feriado, mais um resumo por pessoa. Abre no Excel, no Google Sheets ou no telemóvel.</p>')}
      <div class="acts"><button class="btn wide" id="sheet">Descarregar a folha do mês (Excel)</button>
        <button class="btn ghost wide" id="prim">Ficheiro para o Primavera (Relógio de Ponto)</button></div>
      ${more('Sobre o ficheiro do Primavera', '<p>Horas extra aprovadas, uma linha por pessoa, dia e tipo (1.ª hora, seguintes, descanso, feriado, e os mesmos acima das 100 h do ano). As noturnas não vão neste ficheiro. No Primavera: Recursos Humanos › Alterações Mensais › Relógio de Ponto. O "Nº de trabalhador" tem de ser o número do funcionário no Primavera.</p>')}
      ${can('salarios.configurar') ? `<details class="fold" id="primcfg"><summary><span>Configurar o ficheiro do Primavera<span class="sub">Códigos de horas extra, formato e posições</span></span></summary><div id="primform">${skel(1)}</div></details>` : ''}
      ${can('salarios.configurar') ? `<label class="check prof payest"><input type="checkbox" id="payest" disabled><span><b>Mostrar ao colaborador quanto vai ganhar</b><small>Estimativa do bruto do mês, em «As minhas horas», com o valor à hora de cada um. Só para quem é da empresa (nunca para subempreiteiros).</small></span></label>` : ''}
</div>` : ''}
    ${can('diarias.emitir') ? `<div class="card noprint" id="pdcard"><h2 style="margin-top:0">Diárias</h2>
      <p class="small muted">Pagas à quinta, adiantadas, para a semana toda. Escolhe quem e emite para pagamento.</p>
      <div id="pdbody">${skel(2)}</div>
      ${can('diarias.decidir_faltas') ? `<details class="fold" id="pdcases"><summary><span>Faltas nas diárias pagas<span class="sub">Descontar ou justificar, em todas as obras</span></span></summary><div data-pdcases="all"><div id="pdcasebox">${skel(1)}</div></div></details>` : ''}
      ${can('diarias.configurar') ? `<details class="fold" id="pdcfg"><summary><span>Valores e regra da empresa<span class="sub">Portugal, estrangeiro, mínimo de horas</span></span></summary><div id="pdform">${skel(1)}</div></details>` : ''}</div>` : ''}
    ${can('salarios.exportar') ? `<div class="card noprint"><h2 style="margin-top:0">Registo de tempos (ACT)</h2>
      <p class="small muted">Registo legal das entradas e saídas de uma obra. Guardar 5 anos.</p>
      ${more('Porquê', '<p>Código do Trabalho, art. 202. Mostra-o se a inspeção pedir.</p>')}
      <label for="actsite">Obra</label><select id="actsite">${sites.map((s) => `<option value="${esc(s.id)}">${esc(s.title)} (${esc(s.cost_center_code)})</option>`).join('')}</select>
      <div class="acts"><button class="btn ghost wide" id="act">Descarregar o registo do mês (Excel)</button></div></div>` : ''}
    ${can('contas.gerir') ? `<div class="card noprint"><h2 style="margin-top:0">Departamentos e acessos</h2>
      <p class="small muted">Quem faz o quê na empresa. Cada conta pertence a um ou mais departamentos e só faz o que eles permitem.</p>
      <div id="depts">${skel(2)}</div></div>` : ''}`;
  // Computer mode: the month's days on the left, closing the month and the exports on the right.
  app.innerHTML = isWide() ? `<div class="office-grid"><div class="office-main">${main}</div>
      <aside class="office-side">${can('horas.aprovar') ? '<div id="checklist"></div>' : ''}${side}</aside></div>` : main + side;
  const on = (sel, ev, fn) => { const x = $(sel); if (x) x[ev] = fn; };
  on('#month', 'onchange', (e) => { if (e.target.value) { state.officeMonth = e.target.value; viewOffice(); } });
  const step = (n) => { const [y, m] = state.officeMonth.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); state.officeMonth = d.toISOString().slice(0, 7); viewOffice(); };
  on('#mprev', 'onclick', () => step(-1)); on('#mnext', 'onclick', () => step(1));
  on('#sheet', 'onclick', () => downloadPayroll(from, to));
  on('#prim', 'onclick', () => downloadPrimavera(from, to));
  on('#primcfg', 'ontoggle', () => { if ($('#primcfg').open) showPrimaveraSettings(); });
  if ($('#payest')) sb.rpc('mini_pay_estimate_setting').then(({ data, error }) => {
    const x = $('#payest'); if (!x || error) return;
    x.checked = !!data; x.disabled = false;
    x.onchange = async () => { const { error: e } = await sb.rpc('mini_set_pay_estimate', { p_on: x.checked });
      if (e) { x.checked = !x.checked; return toast(friendly(e)); }
      toast(x.checked ? 'Os colaboradores passam a ver a estimativa do que vão ganhar.' : 'A estimativa deixou de aparecer aos colaboradores.'); };
  });
  on('#act', 'onclick', () => downloadAct($('#actsite').value, from, to));
  on('#pdcfg', 'ontoggle', () => { if ($('#pdcfg').open) showPerDiemSettings(); });
  on('#pdcases', 'ontoggle', () => { if ($('#pdcases').open) loadPdCases('#pdcasebox'); });
  if (can('horas.aprovar')) { loadOffice(from, to); loadPending('#offreq', null); }
  if (can('diarias.emitir')) loadPerDiems();
  if (can('contas.gerir')) loadDepartments();
}

// ------------------------------------------------------------------ Departamentos (admin)
// Each company shapes its own departments; the base ones (Secretariado, Recursos Humanos, Segurança, Encarregados,
// Colaboradores) come ready. A department = a name, the type of access (its profile) and the permissions it gives.
async function loadDepartments() {
  const box = $('#depts'); if (!box) return;
  const [d, p] = await Promise.all([sb.rpc('mini_departments'), sb.rpc('mini_permissions')]);
  if (!box.isConnected) return;
  if (d.error || p.error) { box.innerHTML = `<p>${esc(friendly(d.error || p.error))}</p>`; return; }
  const perms = p.data;
  // "Horas (5) · Salários (2)": the areas a department touches, in the catalog's order; the detail is one tap away.
  const areasOf = (codes) => [...new Set(perms.map((q) => q.area))].map((a) => [a, perms.filter((q) => q.area === a && codes.includes(q.code)).length])
    .filter(([, n]) => n).map(([a, n]) => `${a} (${n})`).join(' · ');
  box.innerHTML = `<div class="list">${d.data.map((x) => `<div class="card link dept${x.is_active ? '' : ' off'}" role="button" tabindex="0" data-dept="${esc(x.id)}">
      <div class="wk"><div class="grow"><b>${esc(x.name)}</b>${x.is_active ? '' : ' ' + chip('', 'arquivado')}
        <div class="sub">${esc(KIND_NAMES[x.kind] || x.kind)} · ${x.members} conta${x.members === 1 ? '' : 's'}</div>
        <div class="small muted">${x.kind === 'admin' ? 'Tudo. Só se dá com aprovação de uma segunda pessoa.' : x.kind === 'worker' ? 'Só as próprias horas e diárias.'
          : x.permissions.length ? esc(areasOf(x.permissions)) : 'Sem permissões.'}</div></div></div></div>`).join('')}</div>
    <p><button class="btn ghost wide" id="newdept">+ Novo departamento</button></p>
    ${more('Como funciona', '<p>Ex.: «Compras» do tipo escritório, só com «Ver trabalhadores». Para dar um departamento a alguém, abre a pessoa em Trabalhadores › Conta na app. Os departamentos não se apagam: arquivam-se, e quem lá estava perde essas permissões.</p>')}`;
  box.querySelectorAll('[data-dept]').forEach((el) => {
    const open = () => editDepartment(d.data.find((x) => x.id === el.dataset.dept), perms);
    el.onclick = open; el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  });
  box.querySelector('#newdept').onclick = () => editDepartment(null, perms);
}
async function editDepartment(x, perms) {
  if (x && x.kind === 'admin') return toast('A Administração tem tudo e não se altera.');
  const kinds = ['hr', 'hse', 'supervisor', 'worker'];
  const areas = [...new Set(perms.map((p) => p.area))];
  const fd = await askSheet(x ? x.name : 'Novo departamento', `
    <label for="dn">Nome *</label><input id="dn" name="name" required minlength="2" maxlength="60" value="${esc(x ? x.name : '')}" placeholder="ex.: Compras e armazém">
    <label>Tipo de acesso *</label><div class="chips reasons" role="radiogroup">${kinds.map((k) => `<label class="chip"><input type="radio" name="kind" value="${k}" required
      ${(x ? x.kind : 'hr') === k ? 'checked' : ''} ${x && x.system_key && x.kind !== k ? 'disabled' : ''}>${esc(KIND_NAMES[k])}</label>`).join('')}</div>
    <p class="small muted" id="kh">${esc(KIND_HELP[x ? x.kind : 'hr'])}</p>
    <div id="pp">${areas.map((a) => `<h3 style="margin:12px 0 4px">${esc(a)}</h3>${perms.filter((p) => p.area === a).map((p) => `<label class="check">
      <input type="checkbox" name="perm" value="${esc(p.code)}" ${x && x.permissions.includes(p.code) ? 'checked' : ''}><span>${esc(p.label)}${p.sensitive ? ' <span class="small muted">· pede código</span>' : ''}</span></label>`).join('')}`).join('')}</div>
    ${x && !x.system_key ? `<p><label class="check"><input type="checkbox" name="arch" ${x.is_active ? '' : 'checked'}>Arquivado (ninguém usa estas permissões)</label></p>` : ''}`,
  'Guardar', (dl) => {
    const pp = dl.querySelector('#pp'); const kh = dl.querySelector('#kh');
    const sync = () => { const k = (dl.querySelector('input[name=kind]:checked') || {}).value; pp.hidden = k === 'worker'; kh.textContent = KIND_HELP[k] || ''; };
    dl.querySelectorAll('input[name=kind]').forEach((r) => r.onchange = sync); sync();
  });
  if (!fd) return;
  const kind = fd.get('kind');
  const { error } = await sb.rpc('mini_save_department', { p_id: x ? x.id : null, p_name: fd.get('name'), p_kind: kind,
    p_perms: kind === 'worker' ? [] : fd.getAll('perm') });
  if (error) return toast(friendly(error));
  if (x && !x.system_key && (fd.get('arch') === 'on') === x.is_active) {
    const { error: e2 } = await sb.rpc('mini_set_department_active', { p_id: x.id, p_active: !x.is_active });
    if (e2) return toast(friendly(e2));
  }
  toast('Departamento guardado.'); loadDepartments();
}
// What the office must look at: taps added by hand, taps that arrived late from a phone without network, and
// supervisors' own taps (mini_manual_taps gives the reason; these two texts come from the server as written).
const tapKind = (reason) => (/^sem rede/.test(reason || '') ? 'sem rede, chegou tarde' : reason === 'picou o próprio cartão' ? 'próprio cartão' : 'à mão');
async function loadOffice(from, to) {
  const el = $('#list'); if (!el) return;
  const [{ data, error }, man, per] = await Promise.all([sb.rpc('mini_hours_office', { p_from: from, p_to: to }),
    sb.rpc('mini_manual_taps', { p_from: from, p_to: to }), dayPeriods(from, to)]);
  if (!el.isConnected) return; // the month changed while this one was loading: its newer list wins
  if (error) { el.innerHTML = `<p>${esc(friendly(error))}</p>`; $('#sum').innerHTML = ''; return; }
  const manual = {};
  for (const m of (man && man.data) || []) (manual[m.work_day_id] = manual[m.work_day_id] || []).push(m);
  const me = state.me && state.me.collaborator_id;
  const n = (st) => data.filter((r) => r.status === st).length;
  for (const r of data) r.flags = dayFlags(r, manual[r.work_day_id]);
  const open = (r) => ['registered', 'supervisor_validated'].includes(r.status);
  const noExit = (r) => open(r) && r.anomalies.some((a) => a === 'missing_out' || a === 'open_shift') && !onlyOpenToday(r, siteTz(r.project_id));
  // Approve by exception: the office looks only at the days with a reason to look; the rest go in one tap.
  const look = data.filter((r) => (r.status === 'supervisor_validated' && r.flags.length) || noExit(r));
  const clean = data.filter((r) => r.status === 'supervisor_validated' && !r.flags.length && !noExit(r) && r.collaborator_id !== me);
  $('#sum').innerHTML = `<div class="kpis k4">
      <div class="kpi" data-f="obra"><b>${n('registered')}</b> <span>por validar na obra</span></div>
      <div class="kpi ${look.length ? 'warn' : ''}" data-f="ti"><b>${look.length}</b> <span>precisam de ti</span></div>
      <div class="kpi ok" data-f="aprovados"><b>${n('hr_validated')}</b> <span>aprovados</span></div>
      <div class="kpi" data-f="fechados"><b>${n('sent_to_payroll')}</b> <span>fechados</span></div></div>
    ${isWide() ? '' : '<div id="checklist"></div>'}`;
  if (isWide() && data.length) {
    officeTable(el, data, manual, per, me, noExit, look);
    return closeChecklist(data, from, to, noExit);
  }
  if (!data.length) { el.innerHTML = `<div class="card">${empty('calendar', 'Sem horas neste mês', 'Escolhe outro mês, ou espera que as obras piquem.')}</div>`; }
  else {
    const byWorker = (rows) => { const g = {}; for (const r of rows) (g[r.collaborator_id] = g[r.collaborator_id] || []).push(r); return Object.values(g); };
    const card = (rows, withFlags) => {
      const tot = rows.reduce((a, r) => a + r.worked_minutes, 0);
      return `<div class="card pcard"><div class="wk">${avatar(rows[0].full_name)}<div class="grow"><h2 style="margin:0;font-size:19px">${esc(rows[0].full_name)}</h2>
        <div class="sub">${rows[0].employee_number ? 'nº ' + esc(rows[0].employee_number) + ' · ' : ''}${rows.length} dia(s)</div></div>
        <div class="hrs" style="font-size:20px;font-weight:800">${esc(fmtMin(tot))}</div></div>
        ${rows.map((r) => officeDay(r, manual[r.work_day_id], per, me, withFlags, noExit(r))).join('')}</div>`;
    };
    el.innerHTML = `<div class="sec-h"><h2>Precisam de ti</h2>${chip(look.length ? 'warn' : 'ok', String(look.length))}</div>
      ${look.length ? byWorker(look).map((rows) => card(rows, true)).join('')
        : `<div class="card">${empty('check', 'Nada para rever', 'Não há dias com problemas, picagens à mão ou horas fora do normal.')}</div>`}
      <div class="sec-h"><h2>Sem problemas</h2>${chip(clean.length ? 'ok' : '', String(clean.length))}</div>
      <div class="card">${clean.length ? `<p class="small muted" style="margin-top:0">Validados na obra, sem avisos: picagens do cartão, sem extra longa, sem descanso nem feriado.</p>
        <p><button class="btn big acc" id="approveClean">${ic('ok')}Aprovar ${clean.length} dia(s) sem problemas</button></p>
        <details class="fold"><summary><span>Ver os ${clean.length} dia(s)<span class="sub">${byWorker(clean).length} pessoa(s)</span></span></summary><div>
          ${byWorker(clean).map((rows) => `<div class="day"><div class="day-h"><span class="d">${esc(rows[0].full_name)}</span>
            <span class="hrs">${esc(fmtMin(rows.reduce((a, r) => a + r.worked_minutes, 0)))}</span></div>
            <div class="per small">${rows.map((r) => `${esc(dayLabel(r.shift_date))} ${esc(r.project_code)} ${esc(fmtMin(r.worked_minutes))}`).join(' · ')}</div></div>`).join('')}</div></details>`
        : '<p class="muted" style="margin:0">Nenhum dia à espera de aprovação simples.</p>'}</div>
      <details class="fold card" style="margin-top:16px"><summary><span>Todos os dias do mês<span class="sub">${data.length} dia(s), todos os estados</span></span></summary><div id="alldays"></div></details>`;
    const all = el.querySelector('details.fold.card');
    all.ontoggle = () => { if (all.open && !$('#alldays').innerHTML) $('#alldays').innerHTML = byWorker(data).map((rows) => card(rows, false)).join(''), bindDays(); };
  }
  const bindDays = () => {
    el.querySelectorAll('button[data-approve]').forEach((b) => b.onclick = () => approveDays([b.dataset.approve]));
    el.querySelectorAll('button[data-back]').forEach((b) => b.onclick = () => returnDay(b.dataset.back));
    el.querySelectorAll('button[data-out]').forEach((b) => b.onclick = async () => {
      const r = data.find((x) => x.work_day_id === b.dataset.out); if (!r) return;
      if (await markOut({ id: r.collaborator_id, name: r.full_name, day: r.shift_date, since: r.first_in, project: r.project_id })) viewOffice();
    });
  };
  bindDays();
  if ($('#approveClean')) $('#approveClean').onclick = () => approveDays(clean.map((r) => r.work_day_id));
  closeChecklist(data, from, to, noExit);
}
// Computer mode: every day of the month in one table. Filters (person, site, state, only with warnings), sorting by
// any column, totals of what is shown, approve several at once, and the same list in Excel.
const OFFICE_FILTERS = [['todos', 'Todos os estados'], ['ti', 'Precisam de ti'], ['obra', 'Por validar na obra'],
  ['validados', 'Validados na obra'], ['aprovados', 'Aprovados'], ['fechados', 'Fechados']];
const STATUS_TEXT = { registered: 'Por validar na obra', supervisor_validated: 'Validado na obra', hr_validated: 'Aprovado', sent_to_payroll: 'Fechado' };
const STATUS_RANK = { registered: 0, supervisor_validated: 1, hr_validated: 2, sent_to_payroll: 3 };
function officeTable(el, data, manual, per, me, noExit, look) {
  if (!el.isConnected) return; // a newer render (another month) took this place
  const q = (sel) => el.querySelector(sel);
  const f = state.officeFilter = state.officeFilter || { q: '', site: '', st: 'todos', warn: false, sort: 'name', dir: 1 };
  const lookIds = new Set(look.map((r) => r.work_day_id));
  const canApprove = (r) => r.status === 'supervisor_validated' && !noExit(r) && r.collaborator_id !== me;
  const sites = [...new Map(data.map((r) => [r.project_id, r])).values()].sort((a, b) => a.project_code.localeCompare(b.project_code));
  const cols = [['name', 'Pessoa'], ['day', 'Dia'], ['site', 'Obra'], [null, 'Entradas e saídas'], ['worked', 'Horas', 1], ['ot', 'Extra', 1],
    ['night', 'Noturnas', 1], ['status', 'Estado'], [null, 'Avisos'], [null, '']];
  el.innerHTML = `<div class="card tbl-card noprint">
    <div class="filters">
      <input id="fq" type="search" placeholder="Procurar nome ou nº" value="${esc(f.q)}" aria-label="Procurar nome ou número">
      <select id="fsite" aria-label="Obra"><option value="">Todas as obras</option>${sites.map((x) =>
        `<option value="${esc(x.project_id)}" ${f.site === x.project_id ? 'selected' : ''}>${esc(x.project_code)} · ${esc(x.project_title)}</option>`).join('')}</select>
      <select id="fst" aria-label="Estado">${OFFICE_FILTERS.map(([k, t]) => `<option value="${k}" ${f.st === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
      <label class="check inline"><input type="checkbox" id="fwarn" ${f.warn ? 'checked' : ''}>Só com avisos</label>
      <button class="btn ghost small" id="fxl" type="button">Excel desta lista</button>
    </div>
    <div class="tbl-wrap"><table class="grid" id="otab"><thead><tr><th class="sel"><input type="checkbox" id="selall" aria-label="Escolher todos os que se podem aprovar"></th>
      ${cols.map(([k, t, num]) => `<th${num ? ' class="num"' : ''}${k ? ` data-sort="${k}" tabindex="0" aria-sort="${f.sort === k ? (f.dir > 0 ? 'ascending' : 'descending') : 'none'}"` : ''}>${esc(t)}</th>`).join('')}</tr></thead>
      <tbody></tbody><tfoot></tfoot></table></div>
    <div class="bulk" id="bulk" hidden><b id="bulkn"></b><button class="btn acc" id="bulkok" type="button">${ic('ok')}Aprovar os escolhidos</button>
      <button class="btn ghost small" id="bulkx" type="button">Limpar escolha</button></div></div>`;
  const key = { name: (r) => r.full_name + r.shift_date, day: (r) => r.shift_date + r.full_name, site: (r) => r.project_code + r.shift_date + r.full_name,
    worked: (r) => r.worked_minutes, ot: (r) => r.overtime_minutes, night: (r) => r.night_minutes, status: (r) => STATUS_RANK[r.status] };
  const match = (r) => {
    const q = f.q.trim().toLowerCase();
    if (q && !`${r.full_name} ${r.employee_number || ''}`.toLowerCase().includes(q)) return false;
    if (f.site && r.project_id !== f.site) return false;
    if (f.warn && !r.flags.length && !noExit(r)) return false;
    return f.st === 'todos' || (f.st === 'ti' && lookIds.has(r.work_day_id)) || (f.st === 'obra' && r.status === 'registered')
      || (f.st === 'validados' && r.status === 'supervisor_validated') || (f.st === 'aprovados' && r.status === 'hr_validated')
      || (f.st === 'fechados' && r.status === 'sent_to_payroll');
  };
  const chosen = new Set();
  let shown = [];
  const otText = (r) => (r.overtime_minutes ? fmtMin(r.overtime_minutes) + (r.overtime_approved ? ' ✓' : r.overtime_approved === false ? ' ✗' : ' ?') : '');
  const draw = () => {
    const k = key[f.sort] || key.name;
    shown = data.filter(match).sort((a, b) => { const x = k(a); const y = k(b); return (x < y ? -1 : x > y ? 1 : 0) * f.dir; });
    for (const id of [...chosen]) if (!shown.some((r) => r.work_day_id === id)) chosen.delete(id);
    q('#otab tbody').innerHTML = shown.map((r) => {
      const tz = siteTz(r.project_id); const mine = r.collaborator_id === me; const ne = noExit(r);
      const warn = r.flags.length ? r.flags : r.anomalies.length ? [['anom', r.anomalies.map((a) => anomalyText(a, r.shift_date, tz)).join(', ')]] : [];
      return `<tr class="${lookIds.has(r.work_day_id) ? 'look' : ''}" data-id="${esc(r.work_day_id)}">
        <td class="sel">${canApprove(r) ? `<input type="checkbox" data-sel="${esc(r.work_day_id)}" ${chosen.has(r.work_day_id) ? 'checked' : ''} aria-label="Escolher ${esc(r.full_name)} ${esc(dayLabel(r.shift_date))}">` : ''}</td>
        <td class="name"><div class="wk">${avatar(r.full_name)}<div><b>${esc(r.full_name)}</b>${r.employee_number ? `<div class="small muted">nº ${esc(r.employee_number)}</div>` : ''}</div></div></td>
        <td class="nowrap">${esc(dayLabel(r.shift_date))}</td>
        <td><span class="chip code" title="${esc(r.project_title)}">${esc(r.project_code)}</span></td>
        <td class="per">${periodsHtml(periodsOf(r, per[r.work_day_id], tz)) || '<span class="muted">sem picagens</span>'}</td>
        <td class="num"><b>${esc(fmtMin(r.worked_minutes))}</b></td>
        <td class="num" title="${r.overtime_minutes ? (r.overtime_approved ? 'aprovadas' : r.overtime_approved === false ? 'recusadas' : 'por decidir') : ''}">${esc(otText(r))}</td>
        <td class="num">${r.night_minutes ? esc(fmtMin(r.night_minutes)) : ''}</td>
        <td>${OFFICE_STATUS[r.status] || esc(r.status)}${r.supervisor_name && r.status !== 'registered' ? `<div class="small muted">por ${esc(r.supervisor_name)}</div>` : ''}</td>
        <td class="why"><div class="chips-row">${warn.map(([c, t]) => chip(c, t)).join('')}</div>${(manual[r.work_day_id] || []).length ? `<div class="small muted" title="${esc(manual[r.work_day_id].map((m) =>
          `${m.direction === 'in' ? 'Entrada' : 'Saída'} ${fmtHour(m.effective_time, tz)} por ${m.added_by || '?'}: ${m.reason || ''}`).join('\n'))}">À mão: ${esc(manual[r.work_day_id].map((m) =>
          `${m.direction === 'in' ? 'entrada' : 'saída'} ${fmtHour(m.effective_time, tz)}`).join(', '))}</div>` : ''}
          ${r.returned_reason ? `<div class="small muted">Devolvido: ${esc(r.returned_reason)}</div>` : ''}</td>
        <td class="acts nowrap">${mine ? '<span class="small muted">as tuas</span>' : `${ne ? `<button class="btn small" data-out="${esc(r.work_day_id)}">Marcar saída</button>` : ''}
          ${canApprove(r) ? `<button class="btn small" data-approve="${esc(r.work_day_id)}">Aprovar</button>` : ''}
          ${['supervisor_validated', 'hr_validated'].includes(r.status) ? `<button class="btn ghost small" data-back="${esc(r.work_day_id)}">Devolver</button>` : ''}`}</td></tr>`;
    }).join('') || `<tr><td colspan="${cols.length + 1}" class="muted" style="text-align:center;padding:24px">Nenhum dia com estes filtros.</td></tr>`;
    const sum = (k2) => shown.reduce((a, r) => a + (r[k2] || 0), 0);
    const people = new Set(shown.map((r) => r.collaborator_id)).size;
    q('#otab tfoot').innerHTML = `<tr><td></td><td colspan="4">${shown.length} dia(s) · ${people} pessoa(s)${shown.length < data.length ? ` <span class="small muted">(de ${data.length})</span>` : ''}</td>
      <td class="num">${esc(fmtMin(sum('worked_minutes')))}</td><td class="num">${esc(fmtMin(sum('overtime_minutes')))}</td>
      <td class="num">${esc(fmtMin(sum('night_minutes')))}</td><td colspan="3"></td></tr>`;
    q('#otab thead').querySelectorAll('th[data-sort]').forEach((th) => th.setAttribute('aria-sort', th.dataset.sort === f.sort ? (f.dir > 0 ? 'ascending' : 'descending') : 'none'));
    document.querySelectorAll('#sum .kpi[data-f]').forEach((x) => x.classList.toggle('on', x.dataset.f === f.st));
    bindRows(); bulk();
  };
  const bulk = () => {
    const can2 = shown.filter(canApprove);
    q('#selall').checked = can2.length > 0 && can2.every((r) => chosen.has(r.work_day_id));
    q('#selall').disabled = !can2.length;
    q('#bulk').hidden = !chosen.size; q('#bulkn').textContent = `${chosen.size} dia(s) escolhido(s)`;
  };
  const bindRows = () => {
    el.querySelectorAll('input[data-sel]').forEach((c) => c.onchange = () => { if (c.checked) chosen.add(c.dataset.sel); else chosen.delete(c.dataset.sel); bulk(); });
    el.querySelectorAll('button[data-approve]').forEach((b) => b.onclick = () => approveDays([b.dataset.approve]));
    el.querySelectorAll('button[data-back]').forEach((b) => b.onclick = () => returnDay(b.dataset.back));
    el.querySelectorAll('button[data-out]').forEach((b) => b.onclick = async () => {
      const r = data.find((x) => x.work_day_id === b.dataset.out); if (!r) return;
      if (await markOut({ id: r.collaborator_id, name: r.full_name, day: r.shift_date, since: r.first_in, project: r.project_id })) viewOffice();
    });
  };
  q('#fq').oninput = (e) => { f.q = e.target.value; draw(); };
  q('#fsite').onchange = (e) => { f.site = e.target.value; draw(); };
  q('#fst').onchange = (e) => { f.st = e.target.value; draw(); };
  q('#fwarn').onchange = (e) => { f.warn = e.target.checked; draw(); };
  q('#selall').onchange = (e) => { for (const r of shown.filter(canApprove)) { if (e.target.checked) chosen.add(r.work_day_id); else chosen.delete(r.work_day_id); } draw(); };
  q('#bulkx').onclick = () => { chosen.clear(); draw(); };
  q('#bulkok').onclick = () => { const ids = [...chosen]; if (ids.length && confirm(`Aprovar ${ids.length} dia(s)?`)) approveDays(ids); };
  q('#otab thead').querySelectorAll('th[data-sort]').forEach((th) => {
    const sortBy = () => { f.dir = f.sort === th.dataset.sort ? -f.dir : 1; f.sort = th.dataset.sort; draw(); };
    th.onclick = sortBy; th.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(); } };
  });
  document.querySelectorAll('#sum .kpi[data-f]').forEach((x) => {
    x.setAttribute('role', 'button'); x.tabIndex = 0;
    const pick = () => { f.st = f.st === x.dataset.f ? 'todos' : x.dataset.f; q('#fst').value = f.st; draw(); };
    x.onclick = pick; x.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
  });
  q('#fxl').onclick = () => downloadOfficeTable(shown, manual, per);
  draw();
}
function downloadOfficeTable(rows, manual, per) {
  if (!rows.length) return toast('Não há dias nesta lista.');
  const { from, to } = monthRange(state.officeMonth);
  excelExport(async () => rows, (X, list) => {
    const doc = xlDoc([], 'Horas do mês (lista filtrada)', `Período: ${periodLabel(from, to)}`, null);
    const wb = xlBook(X, doc);
    const t = xlSheet(wb, 'Horas', doc, [{ h: 'Nº', t: 'text', w: 8, max: 14 }, { h: 'Nome', t: 'text', w: 20, max: 38 }, { h: 'Dia', t: 'date', w: 11 },
      { h: 'Obra', t: 'text', w: 8, max: 14 }, { h: 'Entradas e saídas', t: 'text', w: 18, max: 48 }, { h: 'Horas', t: 'h', w: 8, font: { bold: true } },
      { h: 'Extra', t: 'h', w: 8 }, { h: 'Extra aprovada?', t: 'text', w: 10 }, { h: 'Noturnas', t: 'h', w: 8 }, { h: 'Estado', t: 'text', w: 14, max: 24 },
      { h: 'Avisos', t: 'text', w: 20, max: 70 }]);
    const first = t.head + 1; let r = first; const s = [0, 0, 0];
    for (const x of list) {
      const tz = siteTz(x.project_id);
      xlRow(t, r, [x.employee_number, x.full_name, xlDate(x.shift_date), x.project_code, periodsOf(x, per[x.work_day_id], tz).join(' · '),
        xlH(x.worked_minutes), xlH(x.overtime_minutes), x.overtime_minutes ? (x.overtime_approved ? 'sim' : x.overtime_approved === false ? 'não' : 'por decidir') : '',
        xlH(x.night_minutes), STATUS_TEXT[x.status] || x.status, (x.flags || []).map(([, w]) => w).join('; ')]);
      s[0] += xlH(x.worked_minutes); s[1] += xlH(x.overtime_minutes); s[2] += xlH(x.night_minutes); r++;
    }
    const last = r - 1;
    xlRow(t, r, [null, `Total (${list.length} dia${list.length === 1 ? '' : 's'})`, null, null, null, xlSum(t, 5, first, last, s[0]),
      xlSum(t, 6, first, last, s[1]), null, xlSum(t, 8, first, last, s[2]), null, null], { bold: true, fill: XL.soft, top: true, height: 18 });
    xlFit(t, first, last);
    xlNote(t.ws, r + 2, 'Horas em decimal (7,50 = 7h30). É a lista como estava filtrada no ecrã; a folha de salários do mês está em «Descarregar a folha do mês».');
    return { wb, name: `gestnow-horas-${state.officeMonth}.xlsx`, msg: 'Excel descarregado.' };
  });
}
// Why a day needs the office's eye. Empty = approve without looking.
function dayFlags(r, manual) {
  const tz = siteTz(r.project_id); const f = [];
  if (r.anomalies.length && !onlyOpenToday(r, tz)) f.push(['anom', r.anomalies.map((a) => anomalyText(a, r.shift_date, tz)).join(', ')]);
  for (const k of new Set((manual || []).map((m) => tapKind(m.reason)))) f.push(['warn', k === 'à mão' ? 'picagem à mão' : k]);
  if (r.returned_reason) f.push(['dev', 'já foi devolvido']);
  if (r.special_day_minutes) f.push(['info', r.is_holiday ? 'trabalhou em feriado' : 'trabalhou em dia de descanso']);
  if ((r.overtime_minutes || r.special_day_minutes) && r.overtime_approved == null) f.push(['warn', r.overtime_minutes ? 'extra por decidir' : 'por aprovar pelo chefe']);
  if (r.special_day_minutes && r.overtime_approved === false) f.push(['info', 'chefe não aprovou']);
  else if (r.overtime_minutes > 120) f.push(['info', `${fmtMin(r.overtime_minutes)} extra${r.overtime_approved ? ' aprovadas' : ''}`]);
  if (r.worked_minutes > 12 * 60) f.push(['warn', 'mais de 12 h no dia']);
  return f;
}
// One day in the office lists: site, periods, status, why it is here, who validated, and the actions.
function officeDay(r, manual, per, me, withFlags, noExit) {
  const tz = siteTz(r.project_id); const list = periodsOf(r, per[r.work_day_id], tz);
  const mine = r.collaborator_id === me;
  return `<div class="day"><div class="day-h"><span class="d">${esc(dayLabel(r.shift_date))}</span><span class="chip code">${esc(r.project_code)}</span>
      <span class="hrs">${esc(fmtMin(r.worked_minutes))}</span></div>
    <div class="per">${periodsHtml(list) || '<span class="muted">sem picagens</span>'}</div>
    <div class="tags">${OFFICE_STATUS[r.status] || chip('', r.status)}
      ${r.overtime_minutes && !(withFlags && r.flags.some(([, t]) => / extra|extra /.test(t))) ? chip(r.overtime_approved ? 'info' : r.overtime_approved === false ? '' : 'warn', `${fmtMin(r.overtime_minutes)} extra ${r.overtime_approved ? 'aprovadas' : r.overtime_approved === false ? 'recusadas' : 'por decidir'}`) : ''}</div>
    ${r.special_day_minutes ? `<div class="tags">${chip(r.overtime_approved ? 'info' : r.overtime_approved === false ? '' : 'warn', `${fmtMin(r.special_day_minutes)} em ${r.is_holiday ? 'feriado' : 'dia de descanso'} ${r.overtime_approved ? 'aprovadas pelo chefe' : r.overtime_approved === false ? 'não aprovadas' : 'por aprovar'}`)}</div>` : ''}
    ${withFlags && r.flags.length ? `<div class="why">${r.flags.map(([k, t]) => chip(k, t, k === 'anom' || k === 'warn' ? 'warn' : '')).join('')}</div>` : ''}
    ${!withFlags && r.anomalies.length ? `<div class="why">${chip(onlyOpenToday(r, tz) ? 'warn' : 'anom', r.anomalies.map((a) => anomalyText(a, r.shift_date, tz)).join(', '), onlyOpenToday(r, tz) ? 'clock' : 'warn')}</div>` : ''}
    ${r.supervisor_name && r.status !== 'registered' ? `<div class="note">validado por ${esc(r.supervisor_name)}</div>` : ''}
    ${r.returned_reason ? `<div class="note">Devolvido: ${esc(r.returned_reason)}</div>` : ''}
    ${(manual || []).map((m) => `<div class="note"><span class="chip warn">${esc(tapKind(m.reason))}</span> ${m.direction === 'in' ? 'Entrada' : 'Saída'} ${esc(fmtHour(m.effective_time, tz))}, por ${esc(m.added_by || '?')}: ${esc(m.reason || '')}</div>`).join('')}
    ${mine ? '' : `<div class="acts noprint">
      ${noExit ? `<button class="btn small" data-out="${esc(r.work_day_id)}">${ic('out')}Marcar saída</button>` : ''}
      ${r.status === 'supervisor_validated' && !noExit ? `<button class="btn small" data-approve="${esc(r.work_day_id)}">Aprovar</button>` : ''}
      ${['supervisor_validated', 'hr_validated'].includes(r.status) ? `<button class="btn ghost small" data-back="${esc(r.work_day_id)}">Devolver</button>` : ''}</div>`}</div>`;
}
// The month close as a checklist: what is still missing, where, and the button only when nothing is.
async function closeChecklist(data, from, to, noExit) {
  const box = $('#checklist'); if (!box) return;
  const today = isoDay(new Date()); const me = state.me && state.me.collaborator_id;
  const bySite = (rows) => { const g = {}; for (const r of rows) g[r.project_code + ' ' + r.project_title] = (g[r.project_code + ' ' + r.project_title] || 0) + 1;
    return Object.entries(g).map(([k, v]) => `${k}: ${v}`).join(' · '); };
  const names = (rows) => { const u = [...new Set(rows.map((r) => r.full_name))]; return u.slice(0, 4).join(', ') + (u.length > 4 ? ` e mais ${u.length - 4}` : ''); };
  const atSite = data.filter((r) => r.status === 'registered' && !noExit(r));
  const exits = data.filter(noExit);
  const toApprove = data.filter((r) => r.status === 'supervisor_validated' && !noExit(r));
  const ownDays = toApprove.filter((r) => r.collaborator_id === me);
  const toClose = data.filter((r) => r.status === 'hr_validated').length;
  const closed = data.length > 0 && data.every((r) => r.status === 'sent_to_payroll');
  const noNum = [...new Set(data.filter((r) => (r.overtime_minutes || r.special_day_minutes) && !r.employee_number).map((r) => r.full_name))];
  const steps = [
    { ok: to < today, t: 'O mês acabou', s: to < today ? `Último dia: ${fmtDate(to)}.` : `Só se fecha depois de ${fmtDate(to)}.` },
    { ok: !exits.length, t: 'Nenhuma saída em falta', s: exits.length ? `${exits.length} dia(s): ${names(exits)}. Usa «Marcar saída» em «Precisam de ti».` : 'Todas as entradas têm saída.' },
    { ok: !atSite.length, t: 'As obras validaram tudo', s: atSite.length ? `Faltam ${atSite.length} dia(s). ${bySite(atSite)}. O encarregado valida em «Horas».` : 'Todos os dias foram validados na obra.' },
    { ok: !toApprove.length, t: 'Aprovaste tudo', s: toApprove.length ? `${toApprove.length} dia(s) à tua espera.${ownDays.length ? ` ${ownDays.length} são teus: outra pessoa do escritório tem de os aprovar.` : ''}` : 'Nada à tua espera.' },
  ];
  const done = steps.filter((x) => x.ok).length;
  // Primavera: not needed to close, but the file will not come out without it (only approved days count there).
  let prim = null;
  try {
    const [{ data: c }, { data: lines }] = await Promise.all([sb.rpc('mini_payroll_settings'), sb.rpc('mini_primavera_lines', { p_from: from, p_to: to })]);
    const labels = Object.fromEntries(PRIM_CATS);
    const noCode = c && lines ? [...new Set(lines.filter((l) => !c.codes[l.category]).map((l) => labels[l.category] || l.category))] : [];
    const issues = [];
    if (noNum.length) issues.push(`Falta o Nº de trabalhador de: ${noNum.join(', ')}.`);
    if (noCode.length) issues.push(`Falta o código para: ${noCode.join('; ')}.`);
    prim = { ok: !issues.length, t: 'Pronto para o Primavera', s: issues.length ? issues.join(' ') : 'Números e códigos completos para as horas aprovadas.' };
  } catch (_) { /* the list still works without it */ }
  if (!box.isConnected) return;
  const li = (x, cls) => `<li class="${cls}"><span class="dot">${ic(cls === 'done' ? 'ok' : cls === 'info' ? 'warn' : 'clock')}</span><div><b>${esc(x.t)}</b><div class="sub">${esc(x.s)}</div></div></li>`;
  box.innerHTML = `<div class="card"><h2 style="margin-top:0">${closed ? 'Mês fechado' : 'Fechar o mês'}</h2>
    ${closed ? `<div class="nonfc">${chip('fech', 'Mês fechado')}<span>Estas horas já seguiram para os salários. Ninguém as pode mudar.</span></div>`
    : `<div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="4" aria-valuenow="${done}"><i style="width:${done * 25}%"></i></div>
      <p class="small muted" style="margin:0">${done} de 4 passos feitos</p>
      <ol class="steps">${steps.map((x) => li(x, x.ok ? 'done' : 'todo')).join('')}${prim ? li(prim, prim.ok ? 'done' : 'info') : ''}</ol>
      ${done === 4 && toClose && can('horas.fechar_mes') ? `<p style="margin-top:12px"><button class="btn big" id="closeMonth">${ic('ok')}Fechar o mês para os salários</button></p>
        <p class="small muted">${toClose} dia(s) seguem para os salários. Depois de fechar, ninguém pode mudar as horas deste mês.</p>` : ''}`}</div>`;
  const b = $('#closeMonth');
  if (b) b.onclick = async () => {
    if (!confirm(`Fechar ${fmtDate(from)} a ${fmtDate(to)}? Depois disto ninguém pode mudar as horas deste mês.`)) return;
    const { data: k, error: e } = await sb.rpc('mini_close_period', { p_from: from, p_to: to });
    if (e) return toast(friendly(e));
    toast(`Mês fechado: ${k} dia(s) seguiram para os salários.`); viewOffice();
  };
}
async function approveDays(ids) {
  if (!ids.length) return;
  const { data, error } = await sb.rpc('advance_work_days', { p_ids: ids, p_to: 'hr_validated' });
  if (error) return toast(friendly(error));
  toast(`${data} dia(s) aprovado(s).`); viewOffice();
}
async function returnDay(id) {
  const why = prompt('Porque é que devolves este dia ao encarregado? (ele vai ver o motivo)');
  if (!why) return;
  const { error } = await sb.rpc('mini_return_days', { p_ids: [id], p_reason: why });
  if (error) return toast(friendly(error));
  toast('Dia devolvido ao encarregado.'); viewOffice();
}
// ------------------------------------------------------------------ Primavera: Relógio de Ponto (fixed-width text)
// Each company sets the codes and positions in its Primavera; GestNow copies the same values here.
// Overtime above 100 hours in the year has its own codes (art. 268.º, n.º 2): Primavera pays the higher rate.
const PRIM_CATS = [['ot_first', '1.ª hora extra (dia útil)'], ['ot_next', 'Horas extra seguintes (dia útil)'],
  ['rest_day', 'Trabalho em dia de descanso'], ['holiday', 'Trabalho em feriado'],
  ['ot_first_100', '1.ª hora extra, acima das 100 h do ano'], ['ot_next_100', 'Horas extra seguintes, acima das 100 h do ano'],
  ['rest_day_100', 'Dia de descanso, acima das 100 h do ano'], ['holiday_100', 'Feriado, acima das 100 h do ano']];
const PRIM_FIELDS = [['employee', 'Funcionário'], ['date', 'Data'], ['kind', 'Falta ou hora extra'], ['code', 'Código'],
  ['time', 'Tempo'], ['unit', 'Horas ou dias'], ['exclude_proc', 'Exclui processamento'], ['exclude_stat', 'Exclui estatística'],
  ['meal', 'Subsídio de alimentação'], ['shift', 'Turno']];
const PRIM_DATES = ['dd-mm-yyyy', 'dd/mm/yyyy', 'ddmmyyyy', 'yyyy-mm-dd', 'yyyymmdd'];
function primDate(iso, f) {
  const [y, m, d] = iso.split('-');
  return { 'dd-mm-yyyy': `${d}-${m}-${y}`, 'dd/mm/yyyy': `${d}/${m}/${y}`, ddmmyyyy: d + m + y, 'yyyy-mm-dd': iso, yyyymmdd: y + m + d }[f];
}
// Hours as a decimal number (1,50 = hora e meia), with the company's separator, or with 2 implied decimals (150).
function primTime(minutes, c) {
  const t = (minutes / 60).toFixed(2);
  return c.implied_decimals ? t.replace('.', '') : t.replace('.', c.decimal);
}
async function showPrimaveraSettings() {
  const box = $('#primform'); if (!box) return;
  const { data: c, error } = await sb.rpc('mini_payroll_settings');
  if (error) { box.innerHTML = `<p>${esc(friendly(error))}</p>`; return; }
  const sel = (name, opts, cur) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  box.innerHTML = `<form id="primf">
    <p class="small muted">Copia estes valores do Primavera da tua empresa.</p>
    ${more('Onde estão', '<p>Recursos Humanos › Tabelas › Horas Extra, e a configuração do Relógio de Ponto. Os códigos são inventados por cada empresa: o GestNow não adivinha nenhum.</p>')}
    <h3>Códigos de horas extra da empresa</h3>
    ${PRIM_CATS.map(([k, label]) => `<label>${esc(label)}</label><input name="c_${k}" value="${esc(c.codes[k] || '')}" maxlength="10" autocapitalize="characters">`).join('')}
    <p class="small muted">Um tipo sem código não sai no ficheiro (o GestNow avisa).</p>
    <h3>Formato</h3>
    <div class="row"><div><label>Data</label>${sel('date_format', PRIM_DATES.map((f) => [f, f]), c.date_format)}</div>
      <div><label>Decimais</label>${sel('decimal', [[',', 'vírgula (1,50)'], ['.', 'ponto (1.50)']], c.decimal)}</div></div>
    <div class="row"><div><label>Tempo: encher à esquerda com</label>${sel('time_pad', [['zeros', 'zeros (001,50)'], ['spaces', 'espaços (  1,50)']], c.time_pad)}</div>
      <div><label class="check"><input type="checkbox" name="implied_decimals" ${c.implied_decimals ? 'checked' : ''}> Sem separador (150 = 1,50)</label></div></div>
    <div class="row"><div><label>Letra de hora extra</label><input name="overtime_marker" value="${esc(c.overtime_marker)}" maxlength="1"></div>
      <div><label>Letra de horas</label><input name="unit_marker" value="${esc(c.unit_marker)}" maxlength="1"></div></div>
    <h3>Posições no ficheiro</h3><p class="small muted">Coluna inicial e tamanho (0 = não usa).</p>
    <div class="wk small muted"><div class="grow">Campo</div><span style="width:84px">Início</span><span style="width:84px">Tamanho</span></div>
    ${PRIM_FIELDS.map(([k, label]) => `<div class="day wk"><div class="grow" style="font-weight:650">${esc(label)}</div>
      <input name="p_${k}" type="number" min="1" max="199" value="${esc(c.fields[k][0])}" aria-label="${esc(label)}: início" style="width:84px;flex:0 0 auto">
      <input name="l_${k}" type="number" min="0" max="50" value="${esc(c.fields[k][1])}" aria-label="${esc(label)}: tamanho" style="width:84px;flex:0 0 auto"></div>`).join('')}
    <p><button class="btn wide">Guardar a configuração</button></p></form>`;
  $('#primf').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const settings = { codes: Object.fromEntries(PRIM_CATS.map(([k]) => [k, String(f.get('c_' + k) || '').trim().toUpperCase()])),
      date_format: f.get('date_format'), decimal: f.get('decimal'), time_pad: f.get('time_pad'), implied_decimals: f.get('implied_decimals') === 'on',
      overtime_marker: String(f.get('overtime_marker') || '').trim(), unit_marker: String(f.get('unit_marker') || '').trim(),
      fields: Object.fromEntries(PRIM_FIELDS.map(([k]) => [k, [Number(f.get('p_' + k)), Number(f.get('l_' + k))]])) };
    const { error: e2 } = await sb.rpc('mini_set_payroll_settings', { p_settings: settings });
    if (e2) return toast(friendly(e2));
    toast('Configuração do Primavera guardada.');
  };
}
async function downloadPrimavera(from, to) {
  const [{ data: c, error: e1 }, { data: rows, error: e2 }] = await Promise.all([sb.rpc('mini_payroll_settings'),
    sb.rpc('mini_primavera_lines', { p_from: from, p_to: to })]);
  if (e1 || e2) return toast(friendly(e1 || e2));
  if (!rows.length) return toast('Sem horas extra aprovadas neste mês.');
  const noNumber = [...new Set(rows.filter((r) => !r.employee_number).map((r) => r.full_name))];
  if (noNumber.length) return toast(`Falta o Nº de trabalhador (código do Primavera) de: ${noNumber.join(', ')}.`);
  const badNumber = [...new Set(rows.filter((r) => !/^[\x20-\x7e]+$/.test(r.employee_number)).map((r) => r.full_name))];
  if (badNumber.length) return toast(`O Nº de trabalhador só pode ter letras sem acento, números e sinais simples: ${badNumber.join(', ')}.`);
  const labels = Object.fromEntries(PRIM_CATS);
  const noCode = [...new Set(rows.filter((r) => !c.codes[r.category]).map((r) => labels[r.category] || r.category))];
  if (noCode.length) return toast(`Falta o código do Primavera para: ${noCode.join('; ')}. Põe-no em "Configurar o ficheiro do Primavera".`);
  const width = Math.max(...Object.values(c.fields).map(([p, l]) => p + l - 1));
  const put = (line, key, value, right) => {
    const [p, l] = c.fields[key]; if (!l) return true;
    const v = String(value);
    if (v.length > l) return false;
    const txt = right ? v.padStart(l, c.time_pad === 'spaces' ? ' ' : '0') : v.padEnd(l, ' ');
    for (let i = 0; i < l; i++) line[p - 1 + i] = txt[i];
    return true;
  };
  const lines = []; const tooLong = new Set();
  for (const r of rows) {
    const line = new Array(width).fill(' ');
    const ok = [put(line, 'employee', r.employee_number), put(line, 'date', primDate(r.shift_date, c.date_format)),
      put(line, 'kind', c.overtime_marker), put(line, 'code', c.codes[r.category]),
      put(line, 'time', primTime(r.minutes, c), true), put(line, 'unit', c.unit_marker),
      put(line, 'exclude_proc', '0'), put(line, 'exclude_stat', '0'), put(line, 'meal', '0'), put(line, 'shift', '0')];
    if (ok.includes(false)) { tooLong.add(r.full_name); continue; }
    lines.push(line.join(''));                       // every line the full width of the layout
  }
  if (tooLong.size) return toast(`Um valor não cabe nas posições configuradas (${[...tooLong].join(', ')}). Aumenta o tamanho do campo.`);
  const closed = rows.every((r) => r.all_closed);
  const a = document.createElement('a');
  const text = lines.join('\r\n') + '\r\n';            // only plain ASCII: the same bytes in Windows-1252 and UTF-8
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = `gestnow-primavera-${from.slice(0, 7)}${closed ? '' : '-provisorio'}.txt`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  if (globalThis.GESTNOW_TEST) globalThis.LAST_CSV = { name: a.download, text };
  const over = rows.filter((r) => /_100$/.test(r.category)).length;
  toast((closed ? `Ficheiro do Primavera: ${lines.length} linha(s).` : `Ficheiro provisório: o mês ainda não está fechado (${lines.length} linha(s)).`)
    + (over ? ` ${over} linha(s) já acima das 100 h do ano.` : ''));
}

// ------------------------------------------------------------------ Excel (.xlsx): folha para salários e registo de tempos (ACT)
// Real Excel files, built on the phone. ExcelJS (MIT, in vendor/) is about 1 MB, so it is fetched only when someone taps
// a download button, from this same site (the page's CSP allows scripts only from 'self'; ExcelJS needs no eval).
// Every value from the database goes in as plain text, a number or a date: a name that starts with "=" stays text.
// The only formulas are the totals, built here from column letters and row numbers, never from data.
const XLSX_LIB = 'vendor/exceljs-4.4.0.min.js';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let xlsxLib = null; let xlsxBusy = false;
function loadExcel() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!xlsxLib) {
    xlsxLib = new Promise((resolve, reject) => {
      const s = document.createElement('script'); let timer = null;
      const done = (err) => {
        clearTimeout(timer);
        if (!err && window.ExcelJS) return resolve(window.ExcelJS);
        s.remove(); xlsxLib = null; reject(err || new Error('ExcelJS'));   // the next tap tries again
      };
      timer = setTimeout(() => done(new Error('timeout')), 60000);
      s.src = XLSX_LIB; s.onload = () => done(); s.onerror = () => done(new Error('load'));
      document.head.appendChild(s);
    });
  }
  return xlsxLib;
}
// One export at a time: fetch the rows while ExcelJS loads, build the workbook, hand the file to the phone.
async function excelExport(fetchRows, build) {
  if (xlsxBusy) return;
  xlsxBusy = true;
  try {
    if (!window.ExcelJS) toast('A preparar o Excel…');
    const lib = loadExcel(); lib.catch(() => {});
    const rows = await fetchRows(); if (!rows) return;   // no rows: the user was already told why
    let X;
    try { X = await lib; } catch (e) { return toast('Não consegui preparar o Excel. Verifica a rede e toca outra vez no botão.'); }
    const out = build(X, rows);
    const buf = await out.wb.xlsx.writeBuffer();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: XLSX_TYPE }));
    a.download = out.name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    if (globalThis.GESTNOW_TEST) {   // only in the automatic tests: payroll holds NIFs
      const u = new Uint8Array(buf); let bin = '';
      for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      globalThis.LAST_XLSX = { name: out.name, base64: btoa(bin) };
    }
    toast(out.msg);
  } catch (e) { toast(friendly(e)); } finally { xlsxBusy = false; }
}

const XL = { brand: 'FF0F3D3E', soft: 'FFE7F0EF', mid: 'FFCFE1DF', ink: 'FF142322', muted: 'FF5D6B6A', line: 'FFC9D5D3',
  warnBg: 'FFFFF2D6', warn: 'FF8A5A00', ok: 'FF1F7A3A', grey: 'FF8C9796', rest: 'FFE9EFF7', white: 'FFFFFFFF' };
const XF = { text: '@', h: '0.00;-0.00;"–"', hm: '[h]:mm;-[h]:mm;"–"', n: '0;-0;"–"', date: 'dd/mm/yyyy', time: 'hh:mm', eur: '#,##0.00 "€";-#,##0.00 "€";"–"' };
const XFONT = 'Calibri';
// XML cannot hold control characters: a pasted name with one would make the whole file unreadable.
const xs = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
const xlDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const xlTime = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? (Number(m[1]) * 60 + Number(m[2])) / 1440 : null; };
const xlH = (min) => (min || 0) / 60;
const WEEKDAY = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];
const xlBorder = (argb) => { const s = { style: 'thin', color: { argb } }; return { top: s, left: s, bottom: s, right: s }; };
const xlFill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const exportedBy = () => { const me = state.me || {}; const p = me.collaborator_id && state.people.find((x) => x.id === me.collaborator_id);
  return p ? p.full_name : me.email || ''; };
function periodLabel(from, to) {
  const [y, m] = from.split('-').map(Number);
  const whole = from.endsWith('-01') && to === monthRange(from.slice(0, 7)).to;
  const name = new Date(y, m - 1, 15).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
  return `${whole ? name + ' (' : ''}${fmtDate(from)} a ${fmtDate(to)}${whole ? ')' : ''}`;
}
function xlBook(X, doc) {
  const wb = new X.Workbook();
  wb.creator = 'GestNow'; wb.lastModifiedBy = 'GestNow'; wb.created = wb.modified = new Date();
  wb.title = doc.title; wb.subject = doc.scope; wb.company = doc.company; wb.category = 'GestNow';
  wb.calcProperties.fullCalcOnLoad = true;
  return wb;
}
// Title block, the PROVISÓRIO banner, a two-level header (groups over columns), frozen header, filter and A4 landscape print.
// cols: { h: header, t: text|n|h|hm|date|time, w: min width, max: max width (text grows to fit) }.
function xlSheet(wb, name, doc, cols, groups) {
  const n = cols.length;
  const ws = wb.addWorksheet(name, { properties: { defaultRowHeight: 15 } });
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });
  const line = (r, text, font) => { const c = ws.getCell(r, 1); c.value = xs(text); c.font = { name: XFONT, ...font }; };
  line(1, doc.company, { size: 14, bold: true, color: { argb: XL.brand } });
  line(2, doc.title, { size: 12, bold: true, color: { argb: XL.ink } });
  line(3, doc.scope, { size: 10, color: { argb: XL.ink } });
  line(4, doc.generated, { size: 9, italic: true, color: { argb: XL.muted } });
  ws.getRow(1).height = 20; ws.getRow(2).height = 17;
  let r = 5;
  if (doc.provisional) {
    ws.mergeCells(r, 1, r, n);
    const c = ws.getCell(r, 1);
    c.value = 'PROVISÓRIO – mês ainda não fechado' + (doc.provisional === true ? '' : ': ' + doc.provisional);
    c.font = { name: XFONT, size: 11, bold: true, color: { argb: XL.warn } };
    c.fill = xlFill(XL.warnBg); c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    c.border = xlBorder('FFE9C46A'); ws.getRow(r).height = 22; r++;
  }
  r++;
  const groupRow = groups ? r++ : null;
  if (groups) {
    for (const g of groups) {
      if (g.to > g.from) ws.mergeCells(groupRow, g.from, groupRow, g.to);
      const c = ws.getCell(groupRow, g.from);
      c.value = g.label;
      c.font = { name: XFONT, size: 9, bold: true, color: { argb: XL.brand } };
      c.fill = xlFill(XL.mid); c.alignment = { horizontal: 'center', vertical: 'middle' };
      for (let i = g.from; i <= g.to; i++) ws.getCell(groupRow, i).border = xlBorder(XL.white);
    }
    ws.getRow(groupRow).height = 16;
  }
  const head = r;
  cols.forEach((col, i) => {
    const c = ws.getCell(head, i + 1);
    c.value = col.h;
    c.font = { name: XFONT, size: 10, bold: true, color: { argb: XL.white } };
    c.fill = xlFill(XL.brand); c.border = xlBorder(XL.white);
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: head, topLeftCell: `A${head + 1}`, activeCell: `A${head + 1}`, showGridLines: false }];
  ws.autoFilter = { from: { row: head, column: 1 }, to: { row: head, column: n } };
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.25, footer: 0.3 }, printTitlesRow: `${groupRow || head}:${head}` };
  // "&" starts a code in Excel's header and footer: a site called "A&B" must print as written.
  const hf = (s) => xs(s).slice(0, 90).replace(/&/g, '&&');
  ws.headerFooter = { oddFooter: `&L&8GestNow · ${hf(doc.title)} · ${hf(doc.scope)}&R&8Página &P de &N` };
  return { ws, head, cols };
}
// One table row. vals[i]: number, Date, text, null, or { formula, result } built by this file only.
function xlRow(t, r, vals, opt = {}) {
  const row = t.ws.getRow(r);
  t.cols.forEach((col, i) => {
    const c = row.getCell(i + 1); const v = vals[i];
    const own = opt.cell && opt.cell[i];
    if (v && typeof v === 'object' && !(v instanceof Date) && 'formula' in v) c.value = { formula: v.formula, result: v.result };
    else if (v == null || v === '') c.value = null;
    else if (col.t === 'text' || typeof v === 'string') c.value = xs(v);
    else c.value = v;
    const isText = col.t === 'text' || typeof v === 'string';
    c.numFmt = isText ? XF.text : XF[col.t];
    c.font = { name: XFONT, size: 10, bold: !!opt.bold, color: { argb: XL.ink }, ...(col.font || {}), ...((own && own.font) || {}) };
    const horizontal = col.al || (col.t === 'text' ? 'left' : ['date', 'time'].includes(col.t) || isText ? 'center' : 'right');
    c.alignment = { vertical: 'middle', horizontal, indent: horizontal === 'center' ? 0 : 1 };
    c.border = xlBorder(XL.line);
    const fill = (own && own.fill) || opt.fill;
    if (fill) c.fill = xlFill(fill);
  });
  if (opt.top) row.eachCell({ includeEmpty: true }, (c) => { c.border = { ...c.border, top: { style: 'medium', color: { argb: XL.brand } } }; });
  if (opt.height) row.height = opt.height;
}
// Totals with SUBTOTAL(109): they follow the filter, and a grand total skips the subtotals inside it.
const xlSum = (t, i, first, last, result) => { const L = t.ws.getColumn(i + 1).letter;
  return { formula: `SUBTOTAL(109,${L}${first}:${L}${last})`, result }; };
// Text columns grow to fit their longest value; the header wraps and its row grows to fit.
function xlFit(t, first, last) {
  t.cols.forEach((col, i) => {
    const word = Math.max(...col.h.split(' ').map((x) => x.length));   // a header word is never cut in two
    let len = 0;
    if (col.max) for (let r = first; r <= last; r++) { const v = t.ws.getCell(r, i + 1).value; if (typeof v === 'string') len = Math.max(len, v.length); }
    t.ws.getColumn(i + 1).width = Math.max(Math.ceil(word * 1.15) + 2, Math.min(col.max || col.w, Math.max(col.w, Math.ceil(len * 1.05) + 3)));
  });
  let lines = 1;
  t.cols.forEach((col, i) => {
    const w = t.ws.getColumn(i + 1).width - 1; let n = 1; let cur = 0;
    for (const word of col.h.split(' ')) { if (cur && cur + 1 + word.length > w) { n++; cur = word.length; } else cur += (cur ? 1 : 0) + word.length; }
    lines = Math.max(lines, n);
  });
  t.ws.getRow(t.head).height = 13 * lines + 5;
}
// Page breaks between blocks (one person's month, the notes), so a block does not start at the foot of a page.
// An estimate for A4 landscape fitted to the width; a block longer than a page simply flows on.
function xlBreaks(t, blocks) {
  const ws = t.ws; const h = (r) => ws.getRow(r).height || 15;
  let px = 0; t.cols.forEach((c, i) => { px += ws.getColumn(i + 1).width * 7 + 5; });
  const scale = Math.min(1, ((11.69 - 0.8) * 96) / px);
  const page = ((8.27 - 1.1) * 72 / scale) * 0.9;   // points of sheet per printed page, with a safety margin
  const header = h(t.head) + (t.head > 1 ? h(t.head - 1) : 0);
  let used = 0; for (let r = 1; r <= t.head; r++) used += h(r);
  for (const [a, b] of blocks) {
    let bh = 0; for (let r = a; r <= b; r++) bh += h(r);
    if (used + bh > page && used > header + 1) { ws.getRow(a - 1).addPageBreak(); used = header; }
    used += bh; while (used > page) used -= page - header;
  }
}
// A plain paragraph under the table (notes, signature lines): text overflows to the right, nothing else on the row.
function xlNote(ws, r, text, font = {}) {
  const c = ws.getCell(r, 1); c.value = xs(text);
  c.font = { name: XFONT, size: 9, color: { argb: XL.muted }, ...font };
  c.alignment = { vertical: 'middle' };
}
function xlDoc(rowsOrgs, title, scope, provisional) {
  const orgs = [...new Set(rowsOrgs.filter(Boolean))];
  const now = new Date();
  return { company: orgs.length > 3 ? orgs.slice(0, 3).join(' · ') + ` e mais ${orgs.length - 3}` : orgs.join(' · ') || 'GestNow',
    title, scope, provisional,
    generated: `Gerado em ${now.toLocaleDateString('pt-PT')} às ${now.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`
      + `${exportedBy() ? ' por ' + exportedBy() : ''} · GestNow` };
}

// ---- Folha para salários: "Por obra" (pessoa × obra), "Resumo por pessoa" e "Como ler"
const PAY_HOURS = [['normal_minutes', 'Horas normais'], ['overtime_approved_minutes', 'Extra aprovadas'],
  ['overtime_refused_minutes', 'Extra recusadas'], ['overtime_undecided_minutes', 'Extra por decidir'],
  ['rest_day_minutes', 'Em dia de descanso'], ['holiday_minutes', 'Em feriado']];
const PAY_HELP = [
  ['Nº', 'Número do trabalhador na empresa (é também o código do funcionário no Primavera).'],
  ['Nome, NIF, Empresa', 'Dados da ficha do trabalhador. A empresa é a entidade patronal (pode ser um subempreiteiro).'],
  ['Obra, Nome da obra', 'Onde as horas foram picadas. Quem trabalhou em várias obras tem uma linha por obra na folha «Por obra» e uma só linha na folha «Resumo por pessoa».'],
  ['Obras', 'No resumo: os códigos de todas as obras onde a pessoa trabalhou no período.'],
  ['Dias', 'Dias com horas trabalhadas. Na folha «Por obra» são os dias nessa obra. No resumo por pessoa cada dia conta uma vez, mesmo que a pessoa tenha passado por duas obras nesse dia.'],
  ['Horas normais', 'Horas em dias úteis até ao limite diário normal.'],
  ['Extra aprovadas', 'Horas em dias úteis acima do limite diário, aprovadas. São as que seguem para o Primavera como trabalho suplementar.'],
  ['Extra recusadas', 'Horas que o chefe de equipa recusou: acima do limite diário, ou em dia de descanso ou feriado. Aparecem a cinzento: não se pagam nem se faturam como trabalho suplementar.'],
  ['Extra por decidir', 'Horas acima do limite diário, ou em dia de descanso ou feriado, que o chefe de equipa ainda não aprovou nem recusou. A amarelo quando há alguma: decide-as antes de pagar. Num mês fechado ficam a zero.'],
  ['Em dia de descanso', 'Horas feitas num dia de descanso da obra (cada obra tem os seus, conforme o cliente), aprovadas pelo chefe de equipa.'],
  ['Em feriado', 'Horas feitas em dia feriado, aprovadas pelo chefe de equipa.'],
  ['Total trabalhado (h)', 'Normais + extra aprovadas + extra recusadas + extra por decidir + descanso + feriado. É o tempo picado, já sem a pausa descontada.'],
  ['Total (h:mm)', 'O mesmo total em horas e minutos: 7:30 são sete horas e meia.'],
  ['Das quais noturnas (h)', 'A parte do total feita de noite (por defeito entre as 22:00 e as 7:00). Já está contada nas colunas anteriores: não somar outra vez.'],
  ['Dias por aprovar', 'Dias que o secretariado ainda não aprovou. A amarelo quando há algum.'],
  ['Estado', '«Fechado»: o mês foi fechado para os salários e já não muda. «Provisório»: ainda pode mudar.'],
];
const PAY_NOTES = [
  'As horas estão em número decimal: 7,50 são 7 horas e 30 minutos; 0,25 são 15 minutos. Um traço (–) quer dizer zero.',
  'As linhas de total usam a função SUBTOTAL: se filtrares a tabela, o total passa a somar só as linhas visíveis.',
  'Enquanto o mês não for fechado no GestNow (Secretariado › Fechar o mês), a folha diz PROVISÓRIO e os números ainda podem mudar.',
];
function payCols(first) {
  return [{ h: 'Nº', t: 'text', w: 8, max: 14 }, { h: 'Nome', t: 'text', w: 20, max: 38 }, { h: 'NIF', t: 'text', w: 11, max: 14 },
    { h: 'Empresa', t: 'text', w: 12, max: 30 }, ...first,
    { h: 'Dias', t: 'n', w: 6 },
    ...PAY_HOURS.map(([k, h]) => ({ h, t: 'h', w: 10, font: k === 'overtime_refused_minutes' ? { color: { argb: XL.grey }, italic: true } : undefined })),
    { h: 'Total trabalhado (h)', t: 'h', w: 11, font: { bold: true } }, { h: 'Total (h:mm)', t: 'hm', w: 9 },
    { h: 'Das quais noturnas (h)', t: 'h', w: 10 }, { h: 'Dias por aprovar', t: 'n', w: 9 }, { h: 'Estado', t: 'text', w: 11, al: 'center' }];
}
// Writes the person rows and the grand total; returns the next free row.
function payTable(t, list, firstCol, labelTotal) {
  const D = firstCol; const H = D + 1; const TOT = H + PAY_HOURS.length;   // column indexes (0-based)
  const L = (i) => t.ws.getColumn(i + 1).letter;
  const first = t.head + 1; let r = first;
  const sum = new Array(t.cols.length).fill(0);
  for (const x of list) {
    const hours = PAY_HOURS.map(([k]) => xlH(x[k]));
    const total = hours.reduce((a, b) => a + b, 0);
    const vals = [...x.lead, x.days_worked, ...hours,
      { formula: `SUM(${L(H)}${r}:${L(TOT - 1)}${r})`, result: total }, { formula: `${L(TOT)}${r}/24`, result: total / 24 },
      xlH(x.night_minutes), x.days_pending, x.all_closed ? 'Fechado' : 'Provisório'];
    const cell = {};
    const U = H + PAY_HOURS.findIndex(([k]) => k === 'overtime_undecided_minutes');   // undecided overtime: a flag the office cannot miss
    if (x.overtime_undecided_minutes) cell[U] = { fill: XL.warnBg, font: { bold: true, color: { argb: XL.warn } } };
    if (x.days_pending) cell[TOT + 3] = { fill: XL.warnBg, font: { bold: true, color: { argb: XL.warn } } };
    cell[TOT + 4] = x.all_closed ? { font: { color: { argb: XL.ok } } } : { fill: XL.warnBg, font: { color: { argb: XL.warn } } };
    xlRow(t, r, vals, { cell });
    [x.days_worked, ...hours, total, total / 24, xlH(x.night_minutes), x.days_pending].forEach((v, k) => { sum[D + k] += v; });
    r++;
  }
  const last = r - 1;
  const totals = t.cols.map((c, i) => (i < D ? null : i <= TOT + 3 ? xlSum(t, i, first, last, sum[i]) : null));
  totals[1] = labelTotal;
  xlRow(t, r, totals, { bold: true, fill: XL.soft, top: true, height: 18 });
  xlFit(t, first, last);
  return r + 1;
}
async function downloadPayroll(from, to) {
  let pd = [];
  await excelExport(async () => {
    const [{ data, error }, ded] = await Promise.all([sb.rpc('mini_payroll_lines', { p_from: from, p_to: to }),
      sb.rpc('mini_per_diem_payroll', { p_from: from, p_to: to })]);
    if (error) return void toast(friendly(error));
    if (!data.length) return void toast('Sem horas neste mês.');
    pd = (ded && ded.data) || [];   // no diárias module: the sheet simply has no diárias page
    return data;
  }, (X, data) => {
    const closed = data.every((r) => r.all_closed);
    const pending = data.reduce((a, r) => a + r.days_pending, 0);
    const undecided = data.reduce((a, r) => a + (r.overtime_undecided_minutes || 0), 0);
    const title = 'Folha de horas para salários';
    const doc = xlDoc(data.map((r) => r.organization), title, `Todas as obras · Período: ${periodLabel(from, to)}`,
      closed ? null : pending ? `${pending} dia(s) ainda por aprovar` : 'tudo aprovado, falta fechar o mês');
    const wb = xlBook(X, doc);
    const groups = (n) => [...(n === 2 ? [{ label: 'Trabalhador', from: 1, to: 4 }, { label: 'Obra', from: 5, to: 6 }] : [{ label: 'Trabalhador', from: 1, to: 5 }]),
      { label: 'Tempo trabalhado (horas em decimal: 7,50 = 7h30)', from: 5 + n, to: 14 + n }, { label: 'Fecho do mês', from: 15 + n, to: 16 + n }];
    // 1. one row per person and site
    const t1 = xlSheet(wb, 'Por obra', doc, payCols([{ h: 'Obra', t: 'text', w: 8, max: 14 }, { h: 'Nome da obra', t: 'text', w: 16, max: 34 }]), groups(2));
    let r = payTable(t1, data.map((x) => ({ ...x, lead: [x.employee_number, x.full_name, x.tax_number, x.organization, x.project_code, x.project_title] })),
      6, `Total (${data.length} linha${data.length === 1 ? '' : 's'})`);
    PAY_NOTES.slice(0, 1).concat('Explicação de cada coluna na folha «Como ler».').forEach((s) => { r++; xlNote(t1.ws, r, s); });
    // 2. one row per person (by id, never by name), all sites added up; a day spent on two sites counts once
    const people = new Map();
    for (const x of data) {
      const k = x.collaborator_id;
      const p = people.get(k) || { lead: [x.employee_number, x.full_name, x.tax_number, x.organization], sites: [], days_worked: x.person_days || 0, night_minutes: 0,
        days_pending: 0, all_closed: true, ...Object.fromEntries(PAY_HOURS.map(([h]) => [h, 0])) };
      p.sites.push(x.project_code); p.night_minutes += x.night_minutes; p.days_pending += x.days_pending;
      p.all_closed = p.all_closed && x.all_closed; for (const [h] of PAY_HOURS) p[h] += x[h];
      people.set(k, p);
    }
    const t2 = xlSheet(wb, 'Resumo por pessoa', doc, payCols([{ h: 'Obras', t: 'text', w: 10, max: 30 }]), groups(1));
    r = payTable(t2, [...people.values()].map((p) => ({ ...p, lead: [...p.lead, p.sites.join(', ')] })),
      5, `Total (${people.size} pessoa${people.size === 1 ? '' : 's'})`);
    PAY_NOTES.slice(0, 1).forEach((s) => { r++; xlNote(t2.ws, r, s); });
    // 3. diárias to deduct from the salary: paid in advance, then missed, and not taken from a later diária
    if (pd.length) {
      const t3 = xlSheet(wb, 'Diárias a descontar', doc, [{ h: 'Nº', t: 'text', w: 8, max: 14 }, { h: 'Nome', t: 'text', w: 20, max: 38 },
        { h: 'A descontar no ordenado', t: 'eur', w: 12, font: { bold: true } }, { h: 'Diárias dos dias', t: 'text', w: 20, max: 60 },
        { h: 'Faltas por decidir', t: 'n', w: 9 }]);
      const f3 = t3.head + 1; let r3 = f3;
      for (const x of pd) {
        xlRow(t3, r3, [x.employee_number, x.full_name, Number(x.deduction), x.days || '', Number(x.cases_to_decide)],
          { cell: Number(x.cases_to_decide) ? { 4: { fill: XL.warnBg, font: { bold: true, color: { argb: XL.warn } } } } : {} });
        r3++;
      }
      xlRow(t3, r3, [null, `Total (${pd.length})`, xlSum(t3, 2, f3, r3 - 1, pd.reduce((s, x) => s + Number(x.deduction), 0)), null,
        xlSum(t3, 4, f3, r3 - 1, pd.reduce((s, x) => s + Number(x.cases_to_decide), 0))], { bold: true, fill: XL.soft, top: true, height: 18 });
      xlFit(t3, f3, r3 - 1);
      xlNote(t3.ws, r3 + 2, 'Diárias pagas adiantadas em dias em que a pessoa faltou, sem justificação aceite, e que não couberam numa diária seguinte.');
      xlNote(t3.ws, r3 + 3, 'Faltas por decidir: o encarregado ainda não disse se desconta ou se está justificada. Ao fechar o mês, o que estiver «a descontar» passa para o ordenado.');
    }
    // 4. what each column means
    const ws = wb.addWorksheet('Como ler', { views: [{ showGridLines: false }] });
    ws.getColumn(1).width = 26; ws.getColumn(2).width = 100;
    const put = (row, a, b, f = {}) => { const c1 = ws.getCell(row, 1); const c2 = ws.getCell(row, 2);
      c1.value = a; c2.value = b; c1.font = { name: XFONT, size: 10, bold: true, color: { argb: XL.ink }, ...f };
      c2.font = { name: XFONT, size: 10, color: { argb: XL.ink }, ...f }; c2.alignment = { wrapText: true, vertical: 'top' };
      c1.alignment = { vertical: 'top' }; };
    ws.getCell(1, 1).value = 'Como ler a folha de horas para salários';
    ws.getCell(1, 1).font = { name: XFONT, size: 14, bold: true, color: { argb: XL.brand } };
    ws.getCell(2, 1).value = xs(doc.scope); ws.getCell(2, 1).font = { name: XFONT, size: 10, color: { argb: XL.muted } };
    put(4, 'Coluna', 'O que quer dizer', { color: { argb: XL.white } });
    [1, 2].forEach((i) => { ws.getCell(4, i).fill = xlFill(XL.brand); });
    PAY_HELP.forEach(([a, b], i) => {
      put(5 + i, a, b); [1, 2].forEach((k) => { ws.getCell(5 + i, k).border = { bottom: { style: 'thin', color: { argb: XL.line } } }; });
      ws.getRow(5 + i).height = 15 * Math.ceil(b.length / 105);
    });
    r = 6 + PAY_HELP.length;
    put(r, 'Notas', ''); ws.getCell(r, 1).font = { name: XFONT, size: 11, bold: true, color: { argb: XL.brand } };
    PAY_NOTES.forEach((s, i) => { put(r + 1 + i, '', '• ' + s, { bold: false }); ws.getRow(r + 1 + i).height = 15 * Math.ceil((s.length + 2) / 105); });
    ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } };
    ws.headerFooter = { oddFooter: '&L&8GestNow · Como ler&R&8Página &P de &N' };
    return { wb, name: `gestnow-salarios-${from.slice(0, 7)}${closed ? '' : '-provisorio'}.xlsx`,
      msg: (pending ? `Folha provisória: ainda há ${pending} dia(s) por aprovar.` : closed ? 'Folha descarregada.' : 'Folha provisória: o mês ainda não foi fechado.')
        + (undecided ? ` Há ${fmtMin(undecided)} de horas extra por decidir (coluna a amarelo).` : '')
        + (pd.length ? ` Inclui ${pd.length} pessoa(s) com diárias a descontar.` : '') };
  });
}

// ---- Registo de tempos de trabalho (Código do Trabalho, art. 202.º): uma linha por pessoa e dia, com cada período
const ACT_STATUS = { registered: 'Por validar', supervisor_validated: 'Validado na obra', hr_validated: 'Aprovado', sent_to_payroll: 'Fechado' };
async function downloadAct(site, from, to) {
  if (!site) return toast('Escolhe a obra.');
  const s = state.sites.find((x) => x.id === site) || {};
  await excelExport(async () => {
    // The legal record shows every period of the day, in the site's time zone; each row is one work day and carries
    // its own periods (never joined by name, number or date: two people can share a name and have no number).
    const { data, error } = await sb.rpc('mini_time_record', { p_project: site, p_from: from, p_to: to });
    if (error) return void toast(friendly(error));
    if (!data.length) return void toast('Sem picagens nesta obra neste mês.');
    return data;
  }, (X, data) => {
    const days = data.map((r) => {
      let list = periodList(r.periods);
      if (!list.length && (r.first_in_local || r.last_out_local)) list = [`${r.first_in_local || '?'}–${r.last_out_local || '?'}`];
      return { ...r, periods: list.map((p) => p.split('–')) };
    });
    const K = Math.max(1, ...days.map((d) => d.periods.length));
    const open = data.filter((r) => r.status !== 'sent_to_payroll');
    const pending = data.filter((r) => ['registered', 'supervisor_validated'].includes(r.status)).length;
    const title = 'Registo de tempos de trabalho (art. 202.º do Código do Trabalho)';
    const doc = xlDoc(data.map((r) => r.organization), title,
      `Obra: ${s.cost_center_code || ''} – ${s.title || ''}${s.address ? ' · ' + s.address : ''} · Período: ${periodLabel(from, to)}`,
      open.length ? (pending ? `${pending} dia(s) ainda por aprovar` : 'tudo aprovado, falta fechar o mês') : null);
    const wb = xlBook(X, doc);
    const per2 = [];
    for (let k = 1; k <= K; k++) per2.push({ h: 'Entrada', t: 'time', w: 7.5 }, { h: 'Saída', t: 'time', w: 7.5 });
    const cols = [{ h: 'Nº', t: 'text', w: 8, max: 14 }, { h: 'Nome', t: 'text', w: 20, max: 38 }, { h: 'NIF', t: 'text', w: 11, max: 14 },
      { h: 'Empresa', t: 'text', w: 12, max: 28 }, { h: 'Data', t: 'date', w: 10.5 }, { h: 'Dia da semana', t: 'text', w: 7, al: 'center' }, ...per2,
      { h: 'Pausa descontada (h)', t: 'h', w: 9 }, { h: 'Horas trabalhadas (h)', t: 'h', w: 10, font: { bold: true } },
      { h: 'Horas trabalhadas (h:mm)', t: 'hm', w: 10 }, { h: 'Das quais extra (h)', t: 'h', w: 9 }, { h: 'Das quais noturnas (h)', t: 'h', w: 9 },
      { h: 'Descanso', t: 'text', w: 9, al: 'center' }, { h: 'Feriado', t: 'text', w: 8, al: 'center' }, { h: 'Estado', t: 'text', w: 15, al: 'center' }];
    const P0 = 6; const T0 = P0 + 2 * K;   // first period column, first time column (0-based)
    const groups = [{ label: 'Trabalhador', from: 1, to: 4 }, { label: 'Dia', from: 5, to: 6 }];
    for (let k = 1; k <= K; k++) groups.push({ label: `${k}.º período`, from: P0 + 2 * k - 1, to: P0 + 2 * k });
    groups.push({ label: 'Tempo do dia (horas em decimal: 7,50 = 7h30)', from: T0 + 1, to: T0 + 5 }, { label: 'Tipo de dia', from: T0 + 6, to: T0 + 7 },
      { label: 'Validação', from: T0 + 8, to: T0 + 8 });
    const t = xlSheet(wb, 'Registo de tempos', doc, cols, groups);
    const L = (i) => t.ws.getColumn(i + 1).letter;
    const first = t.head + 1; let r = first; const grand = [0, 0, 0, 0, 0]; let people = 0; const blocks = [];
    for (let i = 0; i < days.length;) {
      const key = (d) => d.collaborator_id;
      const group = []; const k0 = key(days[i]);
      while (i < days.length && key(days[i]) === k0) group.push(days[i++]);
      const g0 = r; const sum = [0, 0, 0, 0, 0]; people++;
      for (const d of group) {
        const date = xlDate(d.shift_date); const cell = {};
        const pv = [];
        for (let k = 0; k < K; k++) {
          const p = d.periods[k] || [];
          for (const j of [0, 1]) {
            const v = p.length ? (xlTime(p[j]) ?? 'falta') : null;
            if (v === 'falta') cell[P0 + 2 * k + j] = { fill: XL.warnBg, font: { bold: true, color: { argb: XL.warn } } };
            pv.push(v);
          }
        }
        const nums = [d.break_minutes, d.worked_minutes, d.worked_minutes, d.overtime_minutes, d.night_minutes].map(xlH);
        nums[2] = nums[1] / 24;
        nums.forEach((v, k) => { sum[k] += v; });
        if (['registered', 'supervisor_validated'].includes(d.status)) cell[T0 + 7] = { fill: XL.warnBg, font: { color: { argb: XL.warn }, bold: true } };
        else if (d.status === 'sent_to_payroll') cell[T0 + 7] = { font: { color: { argb: XL.ok } } };
        xlRow(t, r, [d.employee_number, d.full_name, d.tax_number, d.organization, date, WEEKDAY[date.getUTCDay()], ...pv,
          nums[0], nums[1], { formula: `${L(T0 + 1)}${r}/24`, result: nums[2] }, nums[3], nums[4],
          d.rest_day ? 'Sim' : '', d.holiday ? d.holiday_name || 'Sim' : '',
          (ACT_STATUS[d.status] || d.status) + ((d.anomalies || []).length ? ' – ' + d.anomalies.map((a) => anomalyText(a, d.shift_date, d.site_timezone)).join(', ') : '')],
        { fill: d.rest_day || d.holiday ? XL.rest : null, cell });
        r++;
      }
      const tot = cols.map(() => null);
      tot[1] = `Total – ${group[0].full_name}`; tot[4] = `${group.length} dia${group.length === 1 ? '' : 's'}`;
      for (let k = 0; k < 5; k++) { tot[T0 + k] = xlSum(t, T0 + k, g0, r - 1, sum[k]); grand[k] += sum[k]; }
      xlRow(t, r, tot, { bold: true, fill: XL.soft });
      blocks.push([g0, r]); r++;
    }
    const last = r - 1;
    const tot = cols.map(() => null);
    tot[1] = `Total da obra – ${people} trabalhador${people === 1 ? '' : 'es'}`; tot[4] = `${data.length} dia${data.length === 1 ? '' : 's'}`;
    for (let k = 0; k < 5; k++) tot[T0 + k] = xlSum(t, T0 + k, first, last, grand[k]);
    xlRow(t, r, tot, { bold: true, fill: XL.mid, top: true, height: 18 });
    xlFit(t, first, r);
    blocks[blocks.length - 1][1] = r;   // the site total stays with the last person
    // Notes and signature: the record is printed, signed and kept for 5 years.
    r += 2; const notes = r;
    xlNote(t.ws, r++, 'Registo do início e do fim de cada período de trabalho, com as pausas (Código do Trabalho, art. 202.º). Guardar durante 5 anos e mostrar à ACT quando pedido.');
    xlNote(t.ws, r++, `Horas no fuso horário da obra (${tzName(data[0].site_timezone || DEFAULT_TZ)}). Horas em decimal: 7,50 são 7 horas e 30 minutos. «falta» = picagem em falta nesse período. Linhas a azul-claro: sábado, domingo ou feriado.`);
    r++;
    xlNote(t.ws, r, 'Observações:', { size: 10, bold: true, color: { argb: XL.ink } });
    for (let k = 0; k < 2; k++) {
      r++; t.ws.mergeCells(r, 1, r, cols.length);
      t.ws.getCell(r, 1).border = { bottom: { style: 'thin', color: { argb: XL.muted } } }; t.ws.getRow(r).height = 20;
    }
    r += 2;
    xlNote(t.ws, r, 'Responsável pelo registo: ________________________________________     Assinatura: ________________________________________     Data: ____/____/________',
      { size: 10, color: { argb: XL.ink } });
    t.ws.getRow(r).height = 24;
    xlBreaks(t, [...blocks, [notes - 1, r]]);
    const code = String(s.cost_center_code || 'obra').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'obra';
    return { wb, name: `gestnow-registo-tempos-${code}-${from.slice(0, 7)}.xlsx`,
      msg: open.length ? 'Registo descarregado (provisório: o mês ainda não está fechado).' : 'Registo descarregado.' };
  });
}

// ------------------------------------------------------------------ Obras
function viewSites() {
  const label = { execution: chip('ok', 'em curso', 'ok'), lead: chip('', 'rascunho') };
  // the address usually ends with the country already: never write it twice
  const addr = (s) => String(s.address || '').replace(/[,·\s]*(Portugal|Espanha|España|Spain|França|France)\s*$/i, '');
  app.innerHTML = `<div class="ph"><div><p class="ph-k">${state.sites.filter((x) => x.status === 'execution').length} em curso · ${state.sites.length} no total</p><h1>Obras</h1></div></div>
    ${state.sites.length ? `<div class="list sites">${state.sites.map((s) => `<div class="card${canSiteDetails() ? ' link' : ''}" data-id="${esc(s.id)}" ${canSiteDetails() ? 'role="button" tabindex="0"' : ''}>
      <div class="wk"><span class="av a${s.country === 'ES' ? 7 : s.country === 'FR' ? 3 : 0}" aria-hidden="true">${ic('crane')}</span><div class="grow"><div class="nm">${esc(s.title)}</div>
        <div class="sub">${esc(addr(s))}${s.municipality && s.municipality.toLowerCase() !== addr(s).toLowerCase() ? (addr(s) ? ' · ' : '') + 'concelho ' + esc(s.municipality) : ''}</div></div></div>
      <div class="tags"><span class="chip code">${esc(s.cost_center_code)}</span>${label[s.status] || chip('', s.status)}${flag(s.country, s.id)}</div>
      ${canSiteDetails() ? `<p class="site-go"><button class="btn ghost small" data-panel="${esc(s.id)}">${ic('crane')}Abrir no dashboard</button></p>` : ''}</div>`).join('')}</div>`
      : `<div class="card">${empty('helmet', 'Ainda não há obras', 'Abre a primeira obra aqui em baixo.')}</div>`}
    ${can('obras.gerir') ? `<details class="fold" ${state.sites.length ? '' : 'open'}><summary><span>+ Abrir obra<span class="sub">Cliente, código e nome</span></span></summary><div>
    <form id="f"><div class="row"><div><label>Cliente *</label><input name="client" required placeholder="ex.: Refinaria de Sines"></div>
      <div><label>Código *</label><input name="code" required placeholder="ex.: OB-001"></div></div>
      <label>Nome da obra *</label><input name="title" required placeholder="ex.: Paragem 2026, unidade 3">
      <label>Morada</label><input name="addr">
      <p class="small muted">Abre logo pronta para picar. Depois atribui-lhe os trabalhadores.</p>
      <p><button class="btn wide">Abrir obra</button></p></form></div></details>` : ''}
    ${canSiteDetails() && state.sites.length ? `<h2>País, concelho e feriados da obra</h2><div class="card" id="sitecfg">
      <p class="small muted">O país dá os feriados nacionais e a hora; o concelho, o feriado municipal.</p>
      ${more('Mais', '<p>Portugal: hora de Lisboa. Espanha: hora de Madrid. França: hora de Paris. Os feriados nacionais contam sozinhos; aqui só se põem os municipais e regionais.</p>')}
      <label for="cfgsite">Obra</label><select id="cfgsite">${state.sites.map((s) => `<option value="${esc(s.id)}" ${currentSite() && currentSite().id === s.id ? 'selected' : ''}>${esc(s.title)} (${esc(s.cost_center_code)})</option>`).join('')}</select>
      <div id="cfgbody">${skel(1)}</div></div>` : ''}`;
  if (canSiteDetails()) app.querySelectorAll('.list .card.link').forEach((c) => {
    const open = () => { state.panelSite = c.dataset.id; go('painel'); };
    c.onclick = (e) => { if (!e.target.closest('a,select,input')) open(); };
    c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  });
  if ($('#cfgsite')) { $('#cfgsite').onchange = () => loadSiteDetails($('#cfgsite').value); loadSiteDetails($('#cfgsite').value); }
  if ($('#f')) $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { data, error } = await sb.rpc('mini_open_site', { p_client: f.get('client'), p_title: f.get('title'),
      p_code: f.get('code'), p_address: f.get('addr') || null });
    if (error) return toast(friendly(error));
    store(SITE_KEY, data); toast('Obra aberta.');
    await loadBasics(); viewSites();
  };
}
// Who sees the section (the database checks the same): admin and project manager set country and municipality,
// admin and HR add or remove the site's own holidays, the supervisor only reads.
const COUNTRY = { PT: 'Portugal', ES: 'Espanha', FR: 'França' };
const flag = (c, id) => `<span class="chip" data-flag="${esc(id || '')}" title="${esc(COUNTRY[c] || 'Portugal')}">${{ ES: '🇪🇸 ES', FR: '🇫🇷 FR' }[c] || '🇵🇹 PT'}</span>`;
const canSiteDetails = () => can('obras.ver_detalhes');
const canSetSite = () => can('obras.gerir');
const canHolidays = () => can('obras.feriados');
const canSitePd = () => can('obras.descanso_diaria');
const canRestDays = () => can('obras.descanso_diaria');
const WEEKDAYS = [[1, 'Seg'], [2, 'Ter'], [3, 'Qua'], [4, 'Qui'], [5, 'Sex'], [6, 'Sáb'], [7, 'Dom']];
let siteCfgSeq = 0;
async function loadSiteDetails(id) {
  const box = $('#cfgbody'); if (!box || !canSiteDetails()) return;
  const seq = ++siteCfgSeq;
  const { data: d, error } = await sb.rpc('mini_site_details', { p_project: id });
  if (seq !== siteCfgSeq || !$('#cfgbody')) return;
  if (error) { box.innerHTML = `<p>${esc(friendly(error))}</p>`; return; }
  const hol = d.holidays || [];
  box.innerHTML = `<p style="margin-top:14px">País: <b>${esc(COUNTRY[d.country] || 'Portugal')}</b> · Concelho: <b>${esc(d.municipality || 'por escrever')}</b>
      <span class="small muted">· ${esc(tzName(d.timezone))}</span></p>
    ${canSetSite() ? `<form id="cfgf"><div class="row"><div><label>País</label><select name="country">
        ${Object.entries(COUNTRY).map(([k, v]) => `<option value="${k}" ${(d.country || 'PT') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div><label>Concelho (município)</label><input name="mun" maxlength="128" value="${esc(d.municipality || '')}" placeholder="ex.: Sines"></div></div>
      <p><button class="btn wide">Guardar país e concelho</button></p></form>` : ''}
    <h3>Diária</h3>
    <p style="margin-top:0"><b>${d.per_diem_effective == null ? 'sem valor' : Number(d.per_diem_effective) === 0 ? 'não paga diária' : esc(euro(d.per_diem_effective)) + ' por dia'}</b>
      <span class="small muted">· ${d.per_diem_amount == null ? 'valor da empresa para ' + (d.country === 'PT' || !d.country ? 'Portugal' : 'o estrangeiro') : 'valor próprio desta obra'}</span></p>
    ${canSitePd() ? `<form id="pdsite"><div class="chips reasons" role="radiogroup" aria-label="Diária desta obra">
        <label class="chip"><input type="radio" name="m" value="co" ${d.per_diem_amount == null ? 'checked' : ''}>Valor da empresa</label>
        <label class="chip"><input type="radio" name="m" value="own" ${d.per_diem_amount != null && Number(d.per_diem_amount) > 0 ? 'checked' : ''}>Valor próprio</label>
        <label class="chip"><input type="radio" name="m" value="none" ${d.per_diem_amount != null && Number(d.per_diem_amount) === 0 ? 'checked' : ''}>Não paga</label></div>
      <div id="pdown" ${d.per_diem_amount != null && Number(d.per_diem_amount) > 0 ? '' : 'hidden'}><label for="pdamt">Valor por dia (€)</label>
        <input id="pdamt" name="amt" type="number" min="0.01" max="1000" step="0.01" inputmode="decimal" value="${d.per_diem_amount != null && Number(d.per_diem_amount) > 0 ? Number(d.per_diem_amount).toFixed(2) : ''}"></div>
      <p><button class="btn ghost wide">Guardar diária</button></p></form>` : ''}
    <h3>Dias de descanso</h3>
    <p class="small muted" style="margin-top:0">Depende do cliente. As horas feitas nestes dias só entram na folha se o chefe de equipa as aprovar.</p>
    ${canRestDays() ? `<form id="restf"><div class="chips reasons" role="group" aria-label="Dias de descanso">${WEEKDAYS.map(([n, l]) =>
        `<label class="chip"><input type="checkbox" name="rd" value="${n}" ${(d.rest_days || [6, 7]).includes(n) ? 'checked' : ''}>${esc(l)}</label>`).join('')}</div>
      <p><button class="btn ghost wide">Guardar dias de descanso</button></p></form>`
    : `<p><b>${esc(WEEKDAYS.filter(([n]) => (d.rest_days || [6, 7]).includes(n)).map(([, l]) => l).join(', ') || 'Nenhum')}</b></p>`}
    <h3>Feriados municipais e regionais</h3>
    ${hol.length ? hol.map((h) => `<div class="day wk"><span class="chip code">${esc(fmtDate(h.date))}</span><div class="grow">${esc(h.name)}</div>
      ${canHolidays() ? `<button class="btn small ghost" data-delhol="${esc(h.id)}">Tirar</button>` : ''}</div>`).join('')
      : '<p class="muted small">Nenhum. Os feriados nacionais (de Portugal ou de Espanha) já contam sozinhos.</p>'}
    ${canHolidays() ? (d.municipality ? `<form id="holf"><div class="row"><div><label>Dia</label><input name="date" type="date" required></div>
      <div><label>Nome</label><input name="name" required minlength="3" placeholder="ex.: Dia do Município"></div></div>
      <p class="small muted">Vale para todas as obras deste concelho; as horas desse dia são recalculadas.</p>
      <p><button class="btn ghost wide">Acrescentar feriado</button></p></form>`
      : '<p class="small muted">Para acrescentar o feriado municipal, escreve primeiro o concelho da obra.</p>') : ''}`;
  if ($('#cfgf')) $('#cfgf').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const { error: e2 } = await sb.rpc('mini_set_site_details', { p_project: id, p_country: f.get('country'), p_municipality: String(f.get('mun') || '').trim() });
    if (e2) return toast(friendly(e2));
    toast('País e concelho guardados.'); await loadBasics(); loadSiteDetails(id);
    const s = state.sites.find((x) => x.id === id); const fl = app.querySelector(`[data-flag="${id}"]`);
    if (s && fl) fl.outerHTML = flag(s.country, id);
  };
  if ($('#pdsite')) {
    const f = $('#pdsite');
    f.querySelectorAll('input[name=m]').forEach((r) => r.onchange = () => { $('#pdown').hidden = f.m.value !== 'own'; f.amt.required = f.m.value === 'own'; });
    f.onsubmit = async (e) => {
      e.preventDefault(); const m = f.m.value;
      const amt = m === 'co' ? null : m === 'none' ? 0 : Number(String(f.amt.value).replace(',', '.'));
      if (m === 'own' && !(amt > 0)) return toast('Escreve o valor da diária.');
      const { error: e2 } = await sb.rpc('mini_set_site_per_diem', { p_project: id, p_amount: amt });
      if (e2) return toast(friendly(e2));
      toast('Diária da obra guardada.'); loadSiteDetails(id);
    };
  }
  if ($('#restf')) $('#restf').onsubmit = async (e) => {
    e.preventDefault(); const days = new FormData(e.target).getAll('rd').map(Number);
    if (days.length > 6) return toast('A obra precisa de pelo menos um dia de trabalho.');
    const { data: n, error: e2 } = await sb.rpc('mini_set_site_rest_days', { p_project: id, p_days: days });
    if (e2) return toast(friendly(e2));
    toast(`Dias de descanso guardados.${n ? ` ${n} dia(s) recalculado(s).` : ''}`); loadSiteDetails(id);
  };
  if ($('#holf')) $('#holf').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const { error: e2 } = await sb.rpc('mini_add_site_holiday', { p_project: id, p_date: f.get('date'), p_name: String(f.get('name') || '').trim() });
    if (e2) return toast(friendly(e2));
    toast('Feriado acrescentado.'); loadSiteDetails(id);
  };
  box.querySelectorAll('[data-delhol]').forEach((b) => b.onclick = async () => {
    if (!confirm('Tirar este feriado? As horas desse dia passam a contar como dia normal.')) return;
    const { error: e2 } = await sb.rpc('mini_remove_site_holiday', { p_holiday: b.dataset.delhol });
    if (e2) return toast(friendly(e2));
    toast('Feriado tirado.'); loadSiteDetails(id);
  });
}

// ------------------------------------------------------------------ Dashboard de obra
// Everything the base already knows about one site, on one screen. Phones only with pessoas.ver, hours only with
// horas.ver (the server leaves them out otherwise). Housing, vehicle, tools and PPE say only who provides them for now.
const PROVIDER = { company: 'Empresa', client: 'Cliente', other: 'Outro', none: 'Não precisa' };
const telLink = (t) => t ? `<a href="tel:${esc(String(t).replace(/ /g, ''))}">${esc(t)}</a>` : '';
const fmtHours = (m) => `${Math.round((m || 0) / 6) / 10}`.replace('.', ',') + ' h';
let uiLoading = null;
function loadUI() {
  if (window.GNUI) return Promise.resolve(window.GNUI);
  if (!uiLoading) uiLoading = new Promise((resolve) => {
    const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'ui/gnui.css' });
    document.head.appendChild(css);
    const js = Object.assign(document.createElement('script'), { src: 'ui/gnui.js' });
    js.onload = () => resolve(window.GNUI || null);
    js.onerror = () => { uiLoading = null; resolve(null); };
    document.head.appendChild(js);
  });
  return uiLoading;
}
async function viewSitePanel() {
  // The tab opens the control room (all sites); a site's button in Obras opens that site directly.
  const chosen = state.panelSite; state.panelSite = null;
  const id = chosen || (currentSite() && currentSite().id);
  if (!id) { app.innerHTML = `<h1>Dashboard de obra</h1><div class="card">${empty('helmet', 'Ainda não há obras', 'Abre a primeira obra em Obras.')}</div>`; return; }
  if (chosen && activeSites().some((x) => x.id === chosen)) store(SITE_KEY, chosen);
  app.innerHTML = `<div id="gnp" class="gnpage">${skel(4)}</div>`;
  // The new look (React + Tailwind, ui/gnui.*), loaded the first time; the old screen stays as the fallback.
  const ui = await loadUI();
  const host = $('#gnp'); if (!host || !host.isConnected || state.view !== 'painel') return;
  if (ui) {
    host.innerHTML = ''; state.uiEl = host;
    const api = { rpc: (fn, args) => sb.rpc(fn, args), friendly, toast,
      sites: activeSites().map((x) => ({ id: x.id, title: x.title, code: x.cost_center_code })),
      onSite: (sid) => { store(SITE_KEY, sid); } };
    ui.mountPainel(host, api, chosen || undefined);
    return;
  }
  app.innerHTML = `<div class="noprint">${siteSelect('psite')}</div><div id="pnl" style="margin-top:14px">${skel(4)}</div>`;
  bindSiteSelect('psite', () => { $('#pnl').innerHTML = skel(4); loadSitePanel($('#psite').value); });
  loadSitePanel(id);
}
async function loadSitePanel(id, editing) {
  const box = $('#pnl'); if (!box) return;
  const { data: d, error } = await sb.rpc('mini_site_sheet', { p_project: id });
  if (!box.isConnected) return;
  if (error) { box.innerHTML = `<div class="card"><p>${esc(friendly(error))}</p></div>`; return; }
  if (editing && d.can_edit) return sitePanelForm(box, d);
  const team = d.team || []; const onSite = team.filter((t) => t.on_site).length; const blocked = team.filter((t) => t.missing.length).length;
  const today = isoDay(new Date());
  let timeline = '';
  if (d.start && d.finish) {
    const total = (new Date(d.finish) - new Date(d.start)) / 864e5 + 1; const done = Math.min(total, Math.max(0, (new Date(today) - new Date(d.start)) / 864e5 + 1));
    timeline = `<div class="tl"><div class="tl-bar"><i style="width:${Math.round(done / total * 100)}%"></i></div>
      <div class="tl-txt"><span>${esc(fmtDate(d.start))}</span><b>${today < d.start ? 'começa em ' + Math.round((new Date(d.start) - new Date(today)) / 864e5) + ' dias'
        : today > d.finish ? 'prazo passou' : `dia ${Math.round(done)} de ${Math.round(total)}`}</b><span>${esc(fmtDate(d.finish))}</span></div></div>`;
  }
  const person = (label, p) => `<div><dt>${esc(label)}</dt><dd>${p && p.name ? esc(p.name) + (p.phone ? `<div class="small">${telLink(p.phone)}</div>` : '') : '<span class="muted">por definir</span>'}</dd></div>`;
  const cc = d.client_contact || {};
  const h = d.hours;
  box.innerHTML = `<div class="card"><div class="fhead"><div><h1 style="margin:0">${esc(d.title)}</h1>
        <div class="sub muted">${esc(d.client || '')}${d.address ? ' · ' + esc(d.address) : ''}</div></div>
        ${d.can_edit ? '<button class="btn small ghost" id="pedit">Editar ficha da obra</button>' : ''}</div>
      <div class="tags"><span class="chip code">${esc(d.code)}</span>${d.status === 'execution' ? chip('ok', 'em curso', 'ok') : chip('', d.status)}${flag(d.country, d.id)}
        ${d.municipality ? chip('', 'concelho ' + d.municipality) : ''}</div>
      ${timeline || (d.can_edit ? '<p class="small muted">Sem datas: escreve o início e o fim previsto em «Editar ficha da obra».</p>' : '')}</div>
    <div class="kpis k4">
      <div class="kpi"><b>${team.length}</b><span>na equipa</span></div>
      <div class="kpi ok"><b>${onSite}</b><span>na obra agora</span></div>
      <div class="kpi ${blocked ? 'warn' : ''}"><b>${blocked}</b><span>não podem entrar</span></div>
      <div class="kpi info"><b>${h ? fmtHours(h.worked).replace(' h', '') : '–'}</b><span>horas este mês</span></div></div>
    <div class="painel-grid">
    <div class="card"><h2 style="margin-top:0">Responsáveis</h2><dl class="kv">
      ${person('Responsável de equipa', d.supervisor)}${person('Gestor de obra', d.manager)}
      <div><dt>Contacto do cliente</dt><dd>${cc.name ? esc(cc.name) + (cc.role ? ` <span class="muted">(${esc(cc.role)})</span>` : '')
        + (cc.phone ? `<div class="small">${telLink(cc.phone)}</div>` : '') + (cc.email ? `<div class="small"><a href="mailto:${esc(cc.email)}">${esc(cc.email)}</a></div>` : '') : '<span class="muted">por definir</span>'}</dd></div>
      <div><dt>Diária</dt><dd>${d.per_diem == null ? '<span class="muted">sem valor</span>' : Number(d.per_diem) === 0 ? 'não paga' : esc(euro(d.per_diem)) + ' por dia'}</dd></div></dl></div>
    <div class="card"><h2 style="margin-top:0">Logística</h2><div class="logi">
      ${[['Alojamento', d.housing_by], ['Viatura', d.vehicle_by], ['Ferramentas', d.tools_by], ['EPIs', d.ppe_by]].map(([l, x]) =>
        `<div class="${x ? '' : 'none'}"><span>${l}</span><b>${x ? esc(PROVIDER[x]) : 'por definir'}</b></div>`).join('')}</div>
      ${d.logistics_note ? `<p class="small" style="margin-bottom:0">${esc(d.logistics_note)}</p>` : ''}</div>
    <div class="card span2"><h2 style="margin-top:0">Equipa</h2>
      ${team.length ? team.map((t) => `<div class="day wk">${avatar(t.name)}<div class="grow"><div class="nm">${esc(t.name)}${d.supervisor && d.supervisor.id === t.id ? ' <span class="small muted">· responsável</span>' : ''}</div>
          <div class="sub">${esc(t.job_title || 'sem profissão')}${t.phone ? ' · ' + telLink(t.phone) : ''}</div>
          ${t.missing.length ? `<div class="sub" style="color:var(--bad)">Falta: ${esc(t.missing.join(', '))}</div>` : ''}</div>
        ${t.missing.length ? chip('bad', 'não entra', 'x') : t.on_site ? chip('ok', 'na obra', 'ok') : chip('', 'fora')}</div>`).join('')
        : '<p class="muted">Ninguém atribuído. Atribui pessoas em Trabalhadores › Obras.</p>'}</div>
    <div class="card"><h2 style="margin-top:0">Trabalhos</h2>
      <h3 style="margin-top:0">Descrição</h3><p style="margin-top:0">${d.work_scope ? esc(d.work_scope) : '<span class="muted">por escrever</span>'}</p>
      <h3>Formações obrigatórias</h3><div class="tags">${(d.mandatory || []).map((m) => chip('', m)).join('') || '<span class="muted">nenhuma</span>'}</div>
      ${d.extra_requirements ? `<h3>Requisitos adicionais</h3><p style="margin-top:0">${esc(d.extra_requirements)}</p>` : ''}
      ${d.platform ? `<h3>Plataforma</h3><p style="margin:0">${esc(d.platform)}</p>` : ''}</div>
    ${h ? `<div class="card"><h2 style="margin-top:0">Horas de ${esc(new Date(h.from + 'T12:00:00').toLocaleDateString('pt-PT', { month: 'long' }))}</h2>
      <dl class="kv"><div><dt>Trabalhadas</dt><dd>${fmtHours(h.worked)}</dd></div><div><dt>Extra</dt><dd>${fmtHours(h.overtime)}</dd></div>
        <div><dt>Noturnas</dt><dd>${fmtHours(h.night)}</dd></div><div><dt>Pessoas</dt><dd>${h.people}</dd></div></dl>
      <h3>Dias</h3><div class="tags">${chip(h.registered ? 'warn' : '', `${h.registered} por validar na obra`)}${chip('', `${h.site_validated} por aprovar`)}${chip('ok', `${h.approved} aprovados`)}</div></div>` : ''}
    </div>`;
  if ($('#pedit')) $('#pedit').onclick = () => loadSitePanel(id, true);
}
function sitePanelForm(box, d) {
  const team = d.team || []; const cc = d.client_contact || {};
  const who = (name, label, cur) => `<div><label>${esc(label)}</label><select name="${name}">${Object.entries(PROVIDER).map(([k, t]) =>
    `<option value="${k}" ${cur === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}<option value="" ${cur ? '' : 'selected'}>Por definir</option></select></div>`;
  box.innerHTML = `<div class="card"><h2 style="margin-top:0">Ficha da obra: ${esc(d.title)}</h2><form id="pform">
    <div class="row"><div><label>Início</label><input name="start" type="date" value="${esc(d.start || '')}"></div>
      <div><label>Fim previsto</label><input name="finish" type="date" value="${esc(d.finish || '')}"></div></div>
    <div class="row"><div><label>Responsável de equipa</label><select name="supervisor_id"><option value="">Por definir</option>${team.map((t) =>
        `<option value="${esc(t.id)}" ${d.supervisor && d.supervisor.id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
      <div><label>Gestor de obra</label><select name="manager_id"><option value="">Por definir</option>${(d.people || []).map((t) =>
        `<option value="${esc(t.id)}" ${d.manager && d.manager.id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div></div>
    <p class="small muted">O responsável de equipa escolhe-se entre as pessoas desta obra.</p>
    <h3>Contacto do cliente</h3>
    <div class="row"><div><label>Nome</label><input name="client_contact_name" maxlength="120" value="${esc(cc.name || '')}"></div>
      <div><label>Função</label><input name="client_contact_role" maxlength="80" value="${esc(cc.role || '')}" placeholder="ex.: Fiscal, Gestor de contrato"></div></div>
    <div class="row"><div><label>Telefone</label><input name="client_contact_phone" type="tel" inputmode="tel" maxlength="20" value="${esc(cc.phone || '')}"></div>
      <div><label>Email</label><input name="client_contact_email" type="email" maxlength="120" value="${esc(cc.email || '')}"></div></div>
    <h3>Logística: quem fornece</h3>
    <div class="row">${who('housing_by', 'Alojamento', d.housing_by)}${who('vehicle_by', 'Viatura', d.vehicle_by)}</div>
    <div class="row">${who('tools_by', 'Ferramentas', d.tools_by)}${who('ppe_by', 'EPIs', d.ppe_by)}</div>
    <label>Nota de logística</label><input name="logistics_note" maxlength="500" value="${esc(d.logistics_note || '')}" placeholder="ex.: casa em Sines para 6 pessoas">
    <h3>Trabalhos</h3>
    <label>Descrição dos trabalhos</label><textarea name="work_scope" maxlength="2000" rows="3">${esc(d.work_scope || '')}</textarea>
    <label>Requisitos adicionais</label><textarea name="extra_requirements" maxlength="2000" rows="2">${esc(d.extra_requirements || '')}</textarea>
    <label>Plataforma</label><input name="platform" maxlength="200" value="${esc(d.platform || '')}" placeholder="ex.: portal de acessos do cliente">
    <p class="small muted">As formações obrigatórias são os documentos que «travam a entrada» (em Segurança).</p>
    <div class="row" style="margin-top:12px"><button type="button" class="btn ghost" id="pcancel">Cancelar</button><button class="btn">Guardar ficha da obra</button></div></form></div>`;
  $('#pcancel').onclick = () => loadSitePanel(d.id);
  $('#pform').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const btn = e.target.querySelector('button:not([type])'); btn.disabled = true;
    const body = Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v).trim()]));
    const { error: se } = await sb.rpc('mini_save_site_sheet', { p_project: d.id, p_data: body });
    btn.disabled = false;
    if (se) return toast(friendly(se));
    toast('Ficha da obra guardada.'); loadSitePanel(d.id);
  };
}

// ------------------------------------------------------------------ Mapa do processo (sql/60)
// The chain from the first contact to closing the job, as the database keeps it (a published version never changes).
// Each step says what comes before and after, who is accountable, the proof that stays and the standard it meets.
// The bot explains a step from the same rows, so it never says what the map does not. Every profile but the worker.
const canProcess = () => can('processo.ver');
// Screens built after the map version was published (a published map never changes): the step still points to them.
const PROC_SCREENS_MORE = { S3: ['orcamentos'], P2: ['orcamentos'] };
const PROC_SITE_KEY = 'gestnow.proc.site';
const PROJECT_STATUS = { lead: 'Angariação', bidding: 'Em orçamento', awarded: 'Adjudicada', preparation: 'Em preparação', execution: 'Em execução',
  suspended: 'Suspensa', completed: 'Concluída', invoiced: 'Faturada', closed: 'Fechada' };
const GRADES = { Q1: 'Q1 · nuclear, importante para a segurança', Q2: 'Q2 · nuclear, outros trabalhos', Q3: 'Q3 · convencional' };
const RACI_WORD = { A: 'aprova', R: 'faz', C: 'é consultado', I: 'é informado' };
const RACI_YOU = { A: 'Aprovas', R: 'Fazes', C: 'És consultado', I: 'És informado' };
function procState() { return state.proc || (state.proc = { step: null, mine: false, nuclear: false, site: load(PROC_SITE_KEY, '') || '', ask: 0 }); }
// Opens the map on the step a screen belongs to (the «?» in the top bar).
function openProcessFor(view) {
  procState().fromView = view;
  go('processo');
}
async function viewProcess() {
  if (!canProcess()) return viewClock();   // code guard as well as the database's
  const st = procState();
  app.innerHTML = `<div class="ph"><div><p class="ph-k">ISO 9001 · ISO 19443</p><h1>Mapa do processo</h1></div></div>
    <p class="muted lead">Do primeiro contacto ao fecho de contas. Toca num passo para ver o que vem antes, o que se faz, o que vem depois, quem é responsável e a prova que fica guardada. Os losangos são portões: sem a aprovação, a obra não passa.</p>
    <div id="proc">${skel(4)}</div>`;
  const box = $('#proc');
  let r = await sb.rpc('mini_process_map', { p_site: st.site || null });
  if (r.error && st.site) { st.site = ''; store(PROC_SITE_KEY, ''); r = await sb.rpc('mini_process_map', { p_site: null }); }   // that job is gone or not mine
  if (!box.isConnected) return;
  if (r.error) { box.innerHTML = `<div class="card"><p>${esc(friendly(r.error))}</p></div>`; return; }
  const m = st.map = r.data;
  if (st.siteSeen !== (m.site && m.site.id)) {   // a job just chosen: nuclear follows its grade, the step follows where it is
    st.siteSeen = m.site && m.site.id;
    st.nuclear = !!(m.site && ['Q1', 'Q2'].includes(m.site.grade));
    if (m.site && !st.fromView) st.step = m.site.current;
  }
  if (st.fromView) { const hit = m.steps.find((s) => (s.screens || []).includes(st.fromView)); if (hit) st.step = hit.code; st.fromView = null; }
  if (!st.step || !m.steps.some((s) => s.code === st.step)) st.step = (m.site && m.site.current) || m.steps[0].code;
  st.bot = await getBot(); if (!box.isConnected) return;
  renderProcess();
}
function procChain() { return state.proc.map.steps.filter((s) => s.kind !== 'control'); }
function procRole(s, code) { const r = s.raci || {}; if (r.A === code) return 'A'; for (const k of ['R', 'C', 'I']) if ((r[k] || []).includes(code)) return k; return ''; }
function procMyRole(s) {   // the strongest letter this login has on a step (A before R before C before I)
  let best = ''; const rank = { A: 4, R: 3, C: 2, I: 1, '': 0 };
  for (const role of state.proc.map.roles) if (role.mine) { const x = procRole(s, role.code); if (rank[x] > rank[best]) best = x; }
  return best;
}
const procRoleName = (code) => { const r = state.proc.map.roles.find((x) => x.code === code); return r ? r.name : code; };
function procStatus(s) {   // done / now / '' from where the chosen job is
  const m = state.proc.map; if (!m.site) return '';
  if (m.site.closed) return 'done';
  const order = procChain().map((x) => x.code); const i = order.indexOf(s.code); const cur = order.indexOf(m.site.current);
  return i < cur ? 'done' : i === cur ? 'now' : '';
}
function renderProcess() {
  const st = state.proc; const m = st.map; const box = $('#proc'); if (!box) return;
  const chain = procChain(); const mine = m.roles.filter((r) => r.mine);
  const sites = state.sites.slice().sort((a, b) => String(a.title).localeCompare(b.title, 'pt'));
  const done = chain.filter((s) => procStatus(s) === 'done').length;
  box.innerHTML = `<div class="proc-bar">
      <div class="proc-site"><label for="psite">Ver onde está uma obra</label><select id="psite"><option value="">Nenhuma: só o mapa</option>
        ${sites.map((s) => `<option value="${esc(s.id)}" ${s.id === (m.site && m.site.id) ? 'selected' : ''}>${esc(s.title)} (${esc(s.cost_center_code)})</option>`).join('')}</select></div>
      <div class="chips" role="group" aria-label="Vista">
        <button class="chip" type="button" id="pall" aria-pressed="${!st.mine}">Toda a cadeia</button>
        ${mine.length ? `<button class="chip" type="button" id="pmine" aria-pressed="${st.mine}" title="${esc(mine.map((r) => r.name).join(', '))}">O meu papel</button>` : ''}
        <button class="chip nuc" type="button" id="pnuc" aria-pressed="${st.nuclear}">Nuclear</button>
      </div></div>
    ${m.site ? `<div class="card proc-sum"><div class="grow"><b>${esc(m.site.title)}</b><small>${esc(m.site.code)} · ${esc(PROJECT_STATUS[m.site.status] || m.site.status)} · ${done} de ${chain.length} passos feitos</small>
        <div class="proc-prog" aria-hidden="true"><i style="width:${Math.round(done / chain.length * 100)}%"></i></div></div>
      <div class="proc-grade">${m.site.grade ? chip(['Q1', 'Q2'].includes(m.site.grade) ? 'nuc' : 'reg', m.site.grade === 'Q3' ? 'Convencional (Q3)' : 'Nuclear ' + m.site.grade) : chip('reg', 'Sem grau')}
        ${can('obras.grau') ? '<button class="btn ghost small" id="pgrade">Grau da obra</button>' : ''}</div></div>` : ''}
    ${st.mine ? `<p class="small muted proc-legend">És de ${esc(mine.map((r) => r.name).join(', ').replace(/, ([^,]*)$/, ' e $1'))}. A letra em cada passo é o teu papel: <b>A</b> aprova, <b>R</b> faz, <b>C</b> é consultado, <b>I</b> é informado. Os outros passos ficam esbatidos.</p>` : ''}
    <div class="proc-phases">${m.phases.map((ph, i) => {
      const steps = chain.filter((s) => s.phase === i + 1);
      const open = steps.some((s) => s.code === st.step);
      return `<section class="proc-phase"><h2><span>${i + 1}</span>${esc(ph)}</h2><div class="proc-track">${steps.map((s, k) => {
        const role = procMyRole(s); const stt = procStatus(s);
        return `${k ? `<span class="proc-arrow" aria-hidden="true">${ic('go')}</span>` : ''}<button type="button" class="proc-node ${s.kind} ${stt} ${st.mine && !role ? 'dim' : ''}" data-step="${esc(s.code)}" aria-pressed="${s.code === st.step}">
          ${st.mine && role ? `<span class="proc-role" title="${esc(RACI_WORD[role])}">${role}</span>` : ''}
          <span class="proc-k"><i class="proc-dot"></i>${s.kind === 'gate' ? 'Portão' : 'Passo'} ${chain.indexOf(s) + 1}</span>
          <b>${esc(s.title)}</b><small>${esc(procRoleName(s.raci.A))}${st.nuclear && s.nuclear.length ? ` · <em>+${s.nuclear.length} nuclear</em>` : ''}</small></button>`;
      }).join('')}</div>${open ? '<div id="pcard"></div>' : ''}</section>`;
    }).join('')}</div>
    <p class="small muted proc-loop">${ic('auto')} As lições de cada obra fechada voltam para a Orçamentação da próxima.</p>
    <h2 class="proc-h">Sempre ligados, em qualquer passo</h2>
    <div class="proc-ctl">${m.steps.filter((s) => s.kind === 'control' && (st.nuclear || !s.nuclear.length)).map((s) => `<div class="card"><b>${esc(s.title)}${s.nuclear.length ? ' ' + chip('nuc', 'Nuclear') : ''}</b>
      <p class="small muted">${esc(s.lead)}</p><div class="proc-iso">${s.iso.map((x) => `<span class="chip code">${esc(x)}</span>`).join('')}</div></div>`).join('')}
      ${st.nuclear ? '' : `<div class="card proc-more"><b>+${m.steps.filter((s) => s.kind === 'control' && s.nuclear.length).length} com o modo nuclear</b><p class="small muted">Liga «Nuclear» em cima para ver o controlo de peças falsificadas e a cultura de segurança.</p></div>`}</div>
    <h2 class="proc-h">Pergunta ao ${esc(st.bot.name)}</h2>
    <div class="chips" id="pask">${procQuestions().map((q, i) => `<button class="chip" type="button" data-q="${i}" aria-pressed="${i === st.ask}">${esc(q.q)}</button>`).join('')}</div>
    <div class="card proc-answer" id="pans"></div>
    <p class="small muted">Mapa versão ${esc(m.version)}, publicado a ${esc(fmtDate(String(m.published_at).slice(0, 10)))}. Um mapa publicado nunca é alterado: uma mudança é uma versão nova. Fontes: ${esc(m.sources || '')}</p>`;
  $('#psite').onchange = (e) => { st.site = e.target.value; store(PROC_SITE_KEY, st.site); viewProcess(); };
  $('#pall').onclick = () => { st.mine = false; renderProcess(); };
  if ($('#pmine')) $('#pmine').onclick = () => { st.mine = true; const first = chain.find((s) => procMyRole(s) === 'A') || chain.find((s) => procMyRole(s) === 'R'); if (first) st.step = first.code; renderProcess(); };
  $('#pnuc').onclick = () => { st.nuclear = !st.nuclear; renderProcess(); };
  if ($('#pgrade')) $('#pgrade').onclick = setSiteGrade;
  box.querySelectorAll('.proc-node').forEach((b) => b.onclick = () => {
    Voice.stop(); st.step = b.dataset.step; renderProcess();
    const c = $('#pcard'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  box.querySelectorAll('#pask button').forEach((b) => b.onclick = () => { st.ask = Number(b.dataset.q); box.querySelectorAll('#pask button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); procAnswer(); });
  procCard(); procAnswer();
}
// What the bot says about a step: who, before, here, after, the standard. Built from the map's own rows.
function procExplain(code) {
  const st = state.proc; const chain = procChain(); const i = chain.findIndex((s) => s.code === code); const s = chain[i];
  const prev = chain[i - 1]; const next = chain[i + 1];
  const doers = (s.raci.R || []).filter((x) => x !== s.raci.A);
  const out = [`${s.title}: quem responde é ${procRoleName(s.raci.A)}${doers.length ? `, e quem faz é ${doers.map(procRoleName).join(', ')}` : ''}.`];
  out.push(prev ? `Antes, tem de estar ${prev.kind === 'gate' ? 'aprovado o portão' : 'feito o passo'} «${prev.title}».${st.map.site ? (procStatus(prev) === 'done' ? ' Nesta obra já está.' : ' Nesta obra ainda não está.') : ''}`
    : 'Antes disto não há nada: é aqui que tudo começa.');
  out.push(`Aqui: ${s.actions.slice(0, 3).map((a) => a.charAt(0).toLowerCase() + a.slice(1)).join('; ')}.`);
  out.push(next ? `Depois, segue para ${next.kind === 'gate' ? 'o portão' : 'o passo'} «${next.title}», de ${procRoleName(next.raci.A)}.` : 'Depois, o que se aprendeu volta para a Orçamentação da próxima obra.');
  out.push(`A norma: ${s.iso.map((x) => 'ISO ' + x).join(', ')}${st.nuclear && s.nuclear.length ? ', e a ISO 19443 por ser nuclear' : ''}.`);
  return out;
}
function procCard() {
  const el = $('#pcard'); if (!el) return;
  const st = state.proc; const chain = procChain(); const i = chain.findIndex((s) => s.code === st.step); const s = chain[i];
  const prev = chain[i - 1]; const next = chain[i + 1]; const stt = procStatus(s); const role = procMyRole(s);
  const screens = [...(s.screens || []), ...(PROC_SCREENS_MORE[s.code] || [])].filter((v) => { const b = nav.querySelector(`button[data-view="${v}"]`); return b && !b.hidden; });
  const who = (k, list) => list && list.length ? `<dt>${k}</dt><dd>${list.map((c) => `<span class="chip ${k === 'Aprova' ? 'fech' : 'reg'}">${esc(procRoleName(c))}</span>`).join('')}</dd>` : '';
  el.className = 'card proc-card'; el.setAttribute('aria-live', 'polite');
  el.innerHTML = `<div class="proc-card-h"><p class="ph-k">${s.kind === 'gate' ? 'Portão' : 'Passo'} ${i + 1} de ${chain.length}${stt === 'done' ? ' · ' + chip('ok', 'Feito') : stt === 'now' ? ' · ' + chip('warn', 'A obra está aqui') : ''}${role ? ' · ' + chip('info', RACI_YOU[role]) : ''}</p>
      <h3>${esc(s.title)}</h3><p class="muted">${esc(s.lead)}</p></div>
    <div class="proc-nav"><button type="button" class="btn ghost small" ${prev ? `data-go="${esc(prev.code)}"` : 'disabled'}><span>← Antes</span><b>${esc(prev ? prev.title : 'Início')}</b></button>
      <button type="button" class="btn ghost small" ${next ? `data-go="${esc(next.code)}"` : 'disabled'}><span>Depois →</span><b>${esc(next ? next.title : 'Volta à Orçamentação')}</b></button></div>
    ${s.block ? `<p class="proc-block">${ic('lock')}${esc(s.block)}</p>` : ''}
    <h4>O que se faz aqui</h4><ul class="proc-list">${s.actions.map((a) => `<li>${esc(a)}</li>`).join('')}
      ${st.nuclear ? s.nuclear.map((a) => `<li class="nuc">${chip('nuc', 'Nuclear')} ${esc(a)}</li>`).join('') : ''}</ul>
    <h4>Prova que fica guardada</h4><ul class="proc-list ev">${(s.evidence || []).map((e) => `<li>${e.auto ? chip('info', 'Automático') + ' ' : ''}${esc(e.t)}</li>`).join('')}</ul>
    ${s.auto ? `<p class="proc-auto">${ic('auto')}<span><b>Sem papéis:</b> ${esc(s.auto)}</span></p>` : ''}
    <h4>Quem</h4><dl class="proc-raci">${who('Aprova', [s.raci.A])}${who('Faz', s.raci.R)}${who('Consulta', s.raci.C)}${who('Informa', s.raci.I)}</dl>
    <h4>Norma</h4><div class="proc-iso">${s.iso.map((x) => `<span class="chip code">ISO ${esc(x)}</span>`).join('')}${st.nuclear && s.nuclear.length ? '<span class="chip code nuc">ISO 19443</span><span class="chip code nuc">10 CFR 50 Anexo B</span>' : ''}</div>
    <div class="proc-bot"><div class="bot-3d small">${botFace(st.bot.look)}</div><div class="grow"><b>${esc(st.bot.name)} explica</b>${procExplain(s.code).map((p) => `<p>${esc(p)}</p>`).join('')}</div></div>
    <div class="acts">${screens.map((v) => `<button type="button" class="btn ghost small" data-open="${esc(v)}">${ic('go')}Abrir ${esc(nav.querySelector(`button[data-view="${v}"]`).textContent.trim())}</button>`).join('')}
      ${!screens.length && !(PROC_SCREENS_MORE[s.code] || []).length && !(s.screens || []).length ? '<span class="chip reg">Ecrã deste passo: em construção</span>' : ''}
      <button type="button" class="btn ghost small" id="phear">${ic('voice')}Ouvir ${esc(st.bot.name)}</button></div>`;
  el.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => { Voice.stop(); st.step = b.dataset.go; renderProcess(); const c = $('#pcard'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
  el.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => go(b.dataset.open));
  el.querySelector('#phear').onclick = () => { if (!Voice.ok()) return toast('Este navegador não tem voz.'); Voice.say(procExplain(s.code).join(' '), { face: el.querySelector('.botface') }); };
}
// The questions people ask most, each answered from the map. The first ones follow the roles this login plays.
function procQuestions() {
  const m = state.proc.map; const qs = [];
  for (const r of m.roles.filter((x) => x.mine)) qs.push({ q: `Sou de ${r.name}: o que é meu?`, role: r.code });
  qs.push({ q: 'Vou orçamentar. E antes, e depois?', step: 'S3' }, { q: 'Vou faturar. O que tem de estar feito?', step: 'S9' },
    { q: 'Posso começar a obra?', step: 'P4' }, { q: 'Chegou a encomenda do cliente', step: 'P3' });
  return qs.filter((q) => !q.step || m.steps.some((s) => s.code === q.step)).slice(0, 7);
}
function procAnswer() {
  const el = $('#pans'); if (!el) return;
  const st = state.proc; const q = procQuestions()[st.ask] || procQuestions()[0]; let lines;
  if (q.role) {
    const chain = procChain(); const by = (k) => chain.filter((s) => procRole(s, q.role) === k).map((s) => `«${s.title}»`);
    const a = by('A'); const r = by('R'); const ctl = st.map.steps.filter((s) => s.kind === 'control');
    lines = [`${procRoleName(q.role)} aprova ${a.length ? a.join(', ') : 'nenhum passo'}${r.length ? `, e faz ${r.join(', ')}` : ''}.`,
      `${by('C').length} passos pedem a vossa opinião e ${by('I').length} só vos informam.`];
    if (q.role === 'QUA') lines.push(`A Qualidade também é dona de ${ctl.filter((s) => /não conform|calibra|document|arquivo/i.test(s.title)).map((s) => s.title.toLowerCase()).join(', ')}, que correm por baixo de toda a obra. Responde à Direção e não à Produção, para poder parar a obra.`);
    lines.push('Toca em «O meu papel», em cima, para ver só esses passos.');
  } else lines = procExplain(q.step);
  el.innerHTML = `<div class="proc-bot"><div class="bot-3d small">${botFace(st.bot.look)}</div><div class="grow"><b>${esc(st.bot.name)}</b>${lines.map((p) => `<p>${esc(p)}</p>`).join('')}
    <div class="acts"><button type="button" class="btn ghost small" id="pahear">${ic('voice')}Ouvir</button>${q.step ? `<button type="button" class="btn ghost small" id="pago">Ver no mapa</button>` : ''}</div></div></div>`;
  el.querySelector('#pahear').onclick = () => { if (!Voice.ok()) return toast('Este navegador não tem voz.'); Voice.say(lines.join(' '), { face: el.querySelector('.botface') }); };
  if (q.step) el.querySelector('#pago').onclick = () => { st.step = q.step; renderProcess(); const c = $('#pcard'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
}
async function setSiteGrade() {
  const s = state.proc.map.site; if (!s) return;
  const fd = await askSheet('Grau da obra', `<p class="small muted">O grau liga os controlos da qualidade nuclear (ISO 19443) nesta obra. Muda-se com o código do telemóvel e fica registado.</p>
    <div class="chips reasons" role="radiogroup">${Object.entries(GRADES).map(([k, t]) => `<label class="chip"><input type="radio" name="g" value="${k}" ${s.grade === k ? 'checked' : ''} required>${esc(t)}</label>`).join('')}
      <label class="chip"><input type="radio" name="g" value="" ${!s.grade ? 'checked' : ''}>Sem grau</label></div>`, 'Guardar');
  if (!fd) return;
  const { error } = await sb.rpc('mini_set_site_grade', { p_site: s.id, p_grade: fd.get('g') || null });
  if (error) return toast(friendly(error));
  toast('Grau da obra guardado.'); state.proc.siteSeen = null; viewProcess();
}

// ------------------------------------------------------------------ Orçamentos (sql/62)
// One cost engine, five price forms. The database computes cost and price (what is signed is never this screen's
// arithmetic); the forms here only show that same price the way the client will see it: hours, unit prices, milestones.
// Who signs follows the company's own rules. Whoever made an estimate never signs it, and a sent estimate is frozen.
const canEstimates = () => ['orcamentos.ver', 'orcamentos.gerir', 'orcamentos.aprovar', 'orcamentos.regras'].some(can);
const EST_STATUS = { draft: ['reg', 'Rascunho'], review: ['warn', 'À espera de assinatura'], approved: ['ok', 'Aprovado'], rejected: ['bad', 'Recusado'], superseded: ['reg', 'Substituído'] };
const EST_KIND = { labour: 'Mão de obra', material: 'Material', equipment: 'Equipamento', subcontract: 'Subempreitada', indirect: 'Indireto' };
// AACE 18R-97: how much the real cost may differ from the estimate, by class.
const AACE = { 5: 'Classe 5 · ordem de grandeza (−50 a +100 %)', 4: 'Classe 4 · estudo (−30 a +50 %)', 3: 'Classe 3 · orçamento (−20 a +30 %)',
  2: 'Classe 2 · proposta firme (−15 a +20 %)', 1: 'Classe 1 · definitivo (−10 a +15 %)' };
const EST_FORMS = {
  hh: { n: 'Homem-hora', risk: 15, what: 'O cliente paga as horas que fizermos, a uma tarifa por categoria. As horas são a estimativa, não um preço fechado.',
    bill: 'As horas picadas com o cartão, validadas pelo encarregado, viram o auto de medição.', use: 'Paragens com âmbito incerto, trabalhos emergentes.' },
  up: { n: 'Preço unitário', risk: 45, what: 'O cliente paga cada unidade feita pelo preço da lista. Indiretos, contingência e margem estão espalhados dentro de cada preço.',
    bill: 'As quantidades vêm do que foi feito e medido no terreno.', use: 'Sabe-se o tipo de trabalho mas não a quantidade exata.' },
  ls: { n: 'Chave na mão', risk: 88, what: 'Um preço fechado para o âmbito todo. Se gastarmos mais horas, o prejuízo é nosso. Pede orçamento de classe 2 ou melhor.',
    bill: 'Fatura-se por marcos, cada um quando o seu portão está fechado.', use: 'Âmbito bem definido, desenhos fechados.' },
  mx: { n: 'Misto', risk: 62, what: 'Preço fechado para o que está bem definido, homem-hora para o que pode aparecer. É o mais comum nas paragens.',
    bill: 'Marcos para a parte fechada, horas picadas para os trabalhos a mais.', use: 'Âmbito base fechado e descobertas pelo caminho.' },
  cp: { n: 'Custo + margem', risk: 5, what: 'Livro aberto: o cliente paga o custo real que provarmos e uma margem fixa por cima.',
    bill: 'Custos reais registados (horas picadas, faturas) e a margem acordada.', use: 'Clientes que exigem ver os custos, contratos-quadro longos.' },
};
const eur2 = (v) => Number(v || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const eur0 = (v) => Math.round(Number(v || 0)).toLocaleString('pt-PT') + ' €';
const nPt = (v, d = 0) => Number(v || 0).toLocaleString('pt-PT', { maximumFractionDigits: d });
const estNo = (e) => `ORC-${String(e.number).padStart(4, '0')}${e.version > 1 ? ' v' + e.version : ''}`;
function orcState() { return state.orc || (state.orc = { id: null, mode: 'list', face: null }); }
function openEstimates() { const st = orcState(); st.id = null; st.mode = 'list'; go('orcamentos'); }
async function viewEstimates() {
  if (!canEstimates()) return viewClock();   // code guard as well as the database's
  const st = orcState();
  if (st.mode === 'rules') return viewEstimateRules();
  if (st.id) return viewEstimate(st.id);
  app.innerHTML = `<div class="ph"><div><p class="ph-k">Orçamentar e propor · ISO 9001 §8.2.3</p><h1>Orçamentos</h1></div>
      ${can('orcamentos.gerir') ? '<button class="btn" id="enew">+ Novo orçamento</button>' : ''}</div>
    <p class="muted lead">Um só cálculo de custo e cinco formas de dar o preço ao cliente. Quem assina segue as regras da tua empresa, e quem faz o orçamento nunca o assina.</p>
    <div class="acts orc-top"><button class="btn ghost small" id="erules">${ic('lock')}Quem assina</button></div>
    <div id="elist">${skel(3)}</div>`;
  if ($('#enew')) $('#enew').onclick = newEstimate;
  $('#erules').onclick = () => { st.mode = 'rules'; viewEstimates(); };
  const el = $('#elist');
  const { data, error } = await sb.rpc('mini_estimates');
  if (!el.isConnected) return;
  if (error) { el.innerHTML = `<div class="card"><p>${esc(friendly(error))}</p></div>`; return; }
  if (!data.length) {
    el.innerHTML = `<div class="card">${empty('box', 'Ainda não há orçamentos', can('orcamentos.gerir') ? 'Carrega em «Novo orçamento». Podes começar com um exemplo de números inventados, para aprender o ecrã.' : 'Quando a Orçamentação fizer um, aparece aqui.')}</div>`;
    return;
  }
  const mine = data.filter((e) => e.my_turn);
  el.innerHTML = `${mine.length ? `<div class="brief"><span class="brief-ic">${ic('warn')}</span><div class="grow"><b>É a tua vez de assinar</b> <span>${mine.length} orçamento(s) à tua espera.</span></div></div>` : ''}
    <div class="orc-list">${data.map((e) => {
      const [k, t] = EST_STATUS[e.status] || ['reg', e.status];
      return `<button type="button" class="card orc-item${e.my_turn ? ' turn' : ''}" data-id="${esc(e.id)}">
        <div class="orc-item-h"><span class="orc-no">${esc(estNo(e))}</span>${chip(k, t)}${e.my_turn ? chip('fech', 'Assinar') : ''}</div>
        <b class="orc-t">${esc(e.title)}</b><small class="muted">${esc(e.client)} · ${esc((EST_FORMS[e.form] || {}).n || e.form)} · por ${esc(e.by || '')}</small>
        <span class="orc-price">${eur0(e.price)}</span></button>`;
    }).join('')}</div>`;
  el.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => { st.id = b.dataset.id; st.face = null; viewEstimates(); });
}
async function newEstimate() {
  const { data: r, error: e1 } = await sb.rpc('mini_estimate_rules');
  if (e1) return toast(friendly(e1));
  const forms = r.forms || Object.keys(EST_FORMS);
  const fd = await askSheet('Novo orçamento', `
    <label for="oc">Cliente</label><input id="oc" name="client" required maxlength="120" placeholder="ex.: Refinaria do Norte">
    <label for="ot">O que se orçamenta</label><input id="ot" name="title" required maxlength="160" placeholder="ex.: Paragem 2027, instrumentação da unidade 3">
    <label>Forma de preço</label><div class="chips reasons" role="radiogroup">${forms.map((f, i) => `<label class="chip"><input type="radio" name="form" value="${f}" ${f === 'mx' || (i === 0 && !forms.includes('mx')) ? 'checked' : ''} required>${esc(EST_FORMS[f].n)}</label>`).join('')}</div>
    <p class="small muted">Podes mudar a forma depois: o total não muda, só a maneira de o mostrar ao cliente.</p>
    <label class="check inline"><input type="checkbox" name="ex" checked> Começar com um exemplo de números inventados</label>`, 'Criar');
  if (!fd) return;
  const { data, error } = await sb.rpc('mini_estimate_create', { p_client: String(fd.get('client') || '').trim(), p_title: String(fd.get('title') || '').trim(),
    p_form: fd.get('form'), p_example: !!fd.get('ex') });
  if (error) return toast(friendly(error));
  const st = orcState(); st.id = data; st.face = null; viewEstimates();
}
// The client's view of the same price. Indirects, contingency and margin are spread over what the client sees
// (every euro of direct cost carries its share), so each form adds up to the price the database computed.
function estFace(e, form) {
  const t = e.totals; const price = Number(t.price) || 0;
  const L = e.lines.map((l) => ({ ...l, qty: Number(l.qty), hpu: Number(l.hours_per_unit || 0), cost: Number(l.cost) }));
  const direct = L.filter((l) => l.kind !== 'indirect').reduce((a, l) => a + l.cost, 0);
  const all = L.reduce((a, l) => a + l.cost, 0);
  const f = direct > 0 ? price / direct : 0;
  const cats = {};
  for (const l of L.filter((x) => x.kind === 'labour')) { const k = l.category || 'Mão de obra'; const c = cats[k] || (cats[k] = { h: 0, v: 0 }); c.h += l.qty * l.hpu; c.v += l.cost * f; }
  const topRate = Object.values(cats).sort((a, b) => b.h - a.h).map((c) => (c.h ? c.v / c.h : 0))[0] || 0;
  let head; let rows; let foot = 'Total da proposta';
  if (form === 'hh') {
    head = ['Categoria', 'Horas', 'Tarifa', 'Valor estimado']; foot = 'Total estimado';
    rows = Object.entries(cats).map(([k, c]) => [k, nPt(c.h, 1) + ' h', c.h ? eur2(c.v / c.h) + '/h' : '', c.v]);
    const other = L.filter((l) => l.kind !== 'labour' && l.kind !== 'indirect').reduce((a, l) => a + l.cost, 0);
    if (other > 0) rows.push(['Materiais, equipamento e subempreitadas', '', 'custo + ' + nPt((f - 1) * 100, 1) + ' %', other * f]);
  } else if (form === 'up') {
    head = ['Item', 'Quantidade', 'Preço unitário', 'Total'];
    const groups = new Map();
    for (const l of L.filter((x) => x.kind !== 'indirect')) {
      const k = l.package || l.description; const g = groups.get(k) || { lines: [], v: 0 }; g.lines.push(l); g.v += l.cost * f; groups.set(k, g);
    }
    rows = [...groups.entries()].map(([k, g]) => {
      const base = g.lines.find((l) => l.kind === 'labour') || g.lines[0];
      return [k, nPt(base.qty, 2) + ' ' + base.unit, base.qty ? eur2(g.v / base.qty) : '', g.v];
    });
  } else if (form === 'ls') {
    head = ['Marco de pagamento', '%', '', 'Valor'];
    rows = [['Mobilização e plano de inspeção aprovado', 15], ['Trabalho principal feito (conclusão mecânica)', 35], ['Testes e ensaios aceites', 35], ['Dossiê final (Data Book) entregue e aceite', 15]]
      .map(([n, p]) => [n, p + ' %', '', price * p / 100]);
  } else if (form === 'mx') {
    head = ['Parte', 'Forma', '', 'Valor'];
    const open = price * Number(e.open_pct) / 100;
    rows = [['Âmbito definido', 'Preço fechado', '', price - open], ['Trabalhos a mais (reserva estimada)', 'Homem-hora' + (topRate ? ': ' + eur2(topRate) + '/h' : ''), '', open]];
  } else {
    head = ['Linha', '', '', 'Valor estimado']; foot = 'Total estimado';
    const cc = Number(t.cost) + Number(t.contingency || 0);
    rows = [['Custo real (estimativa, com contingência)', '', '', cc], [`Margem acordada (${nPt(e.margin_pct, 1)} % do preço)`, '', '', price - cc]];
  }
  // cents: the last row takes the rounding, so the table always adds up to the signed price
  rows = rows.map((r) => [r[0], r[1], r[2], Math.round(r[3] * 100) / 100]);
  if (rows.length && direct > 0) rows[rows.length - 1][3] = Math.round((price - rows.slice(0, -1).reduce((a, r) => a + r[3], 0)) * 100) / 100;
  return { head, rows, foot, empty: !(all > 0) };
}
async function viewEstimate(id) {
  app.innerHTML = `<div id="eone">${skel(4)}</div>`;
  const { data: e, error } = await sb.rpc('mini_estimate', { p_estimate: id });
  const box = $('#eone'); if (!box) return;
  if (error) { orcState().id = null; box.innerHTML = `<div class="card"><p>${esc(friendly(error))}</p></div>`; return; }
  const st = orcState(); st.e = e;
  if (!st.face || !e.forms.includes(st.face)) st.face = e.form;
  renderEstimate();
}
function renderEstimate() {
  const st = orcState(); const e = st.e; const box = $('#eone'); if (!box) return;
  const t = e.totals; const [k, stx] = EST_STATUS[e.status] || ['reg', e.status];
  const edit = e.can_edit;
  const margin = Number(t.price) - Number(t.cost) - Number(t.contingency || 0);
  const pkgs = new Map();
  for (const l of e.lines) { const g = pkgs.get(l.package || '') || []; g.push(l); pkgs.set(l.package || '', g); }
  const face = estFace(e, st.face); const F = EST_FORMS[st.face];
  const total = face.rows.reduce((a, r) => a + r[3], 0);
  const reqOk = e.requirements.every((q) => q.got >= q.need);
  box.innerHTML = `<button class="btn ghost small orc-back" id="eback">← Orçamentos</button>
    <div class="ph"><div><p class="ph-k">${esc(estNo(e))} · ${esc(e.client)}</p><h1>${esc(e.title)}</h1></div>${chip(k, stx)}</div>
    ${e.notes ? `<p class="small muted">${esc(e.notes)}</p>` : ''}
    <div class="kpis orc-kpis"><div class="kpi"><b>${eur0(t.cost)}</b><span>Custo</span></div><div class="kpi"><b>${eur0(t.contingency)}</b><span>Contingência ${nPt(e.contingency_pct, 1)} %</span></div>
      <div class="kpi"><b>${eur0(margin)}</b><span>Margem ${nPt(e.margin_pct, 1)} %</span></div><div class="kpi big hot"><b id="eprice">${eur0(t.price)}</b><span>Preço de venda</span></div></div>
    <div class="orc-cols"><section class="orc-cost">
      <div class="sec-h"><h2>O custo</h2><span class="small muted">${nPt(t.hours, 1)} horas · só a tua empresa vê</span></div>
      <div class="card orc-knobs">
        <label for="ecc">Contingência <b id="eccv">${nPt(e.contingency_pct, 1)} %</b></label><input type="range" id="ecc" min="0" max="30" step="0.5" value="${esc(e.contingency_pct)}" ${edit ? '' : 'disabled'}>
        <label for="emg">Margem <b id="emgv">${nPt(e.margin_pct, 1)} %</b></label><input type="range" id="emg" min="0" max="40" step="0.5" value="${esc(e.margin_pct)}" ${edit ? '' : 'disabled'}>
        <p class="small muted">Preço = (custo + contingência) ÷ (1 − margem). A margem conta-se sobre o preço, não sobre o custo.</p>
        <div class="row"><div><label for="eaace">Qualidade do orçamento (AACE)</label><select id="eaace" ${edit ? '' : 'disabled'}>${[5, 4, 3, 2, 1].map((c) => `<option value="${c}" ${Number(e.aace_class) === c ? 'selected' : ''}>${esc(AACE[c])}</option>`).join('')}</select></div></div>
        <label class="check inline"><input type="checkbox" id="enewc" ${e.new_client ? 'checked' : ''} ${edit ? '' : 'disabled'}> Cliente novo (primeira obra)</label>
        <label class="check inline"><input type="checkbox" id="enuc" ${e.nuclear ? 'checked' : ''} ${edit ? '' : 'disabled'}> Obra nuclear</label>
      </div>
      <div class="orc-lines">${e.lines.length ? [...pkgs.entries()].map(([p, ls]) => `<div class="card orc-pkg"><div class="orc-pkg-h"><b>${esc(p || 'Sem pacote')}</b><span>${eur0(ls.reduce((a, l) => a + Number(l.cost), 0))}</span></div>
        ${ls.map((l) => `<button type="button" class="orc-line" data-line="${esc(l.id)}" ${edit ? '' : 'disabled'}><span class="grow"><span>${esc(l.description)}</span>
          <small>${chip('reg', EST_KIND[l.kind])} ${l.kind === 'labour' ? `${nPt(l.qty, 2)} ${esc(l.unit)} × ${nPt(l.hours_per_unit, 2)} h × ${eur2(l.cost_rate)}/h${l.category ? ' · ' + esc(l.category) : ''}` : `${nPt(l.qty, 2)} ${esc(l.unit)} × ${eur2(l.cost_rate)}`}</small></span>
          <span class="num">${eur0(l.cost)}</span></button>`).join('')}</div>`).join('')
        : `<div class="card">${empty('box', 'Sem linhas', 'Acrescenta mão de obra, materiais, equipamento, subempreitadas e indiretos.')}</div>`}</div>
      ${edit ? `<button class="btn ghost wide" id="eadd">+ Acrescentar linha</button>` : ''}
    </section>
    <section class="orc-face">
      <div class="sec-h"><h2>O que o cliente vê</h2></div>
      <div class="chips" role="group" aria-label="Forma de preço">${e.forms.map((f) => `<button type="button" class="chip" data-f="${f}" aria-pressed="${f === st.face}">${esc(EST_FORMS[f].n)}${f === e.form ? ' ✓' : ''}</button>`).join('')}</div>
      <div class="card orc-facecard"><p class="small">${esc(F.what)}</p>
        <div class="tbl-wrap"><table class="grid orc-tbl"><thead><tr>${face.head.map((h, i) => `<th class="${i >= 2 ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${face.rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="num">${esc(r[2])}</td><td class="num">${eur2(r[3])}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3">${esc(face.foot)}</td><td class="num">${eur2(total)}</td></tr></tfoot></table></div>
        ${face.empty ? '' : Math.abs(total - Number(t.price)) < 0.01 ? `<p class="orc-same">${ic('ok')}Igual ao preço calculado: ${eur2(t.price)}</p>` : `<p class="orc-same bad">${ic('warn')}Diferença de ${eur2(total - Number(t.price))}</p>`}
        <div class="orc-risk" aria-label="Risco para nós"><span>Risco para nós</span><i><u style="left:${F.risk}%"></u></i><small>baixo</small><small>alto</small></div>
        <dl class="orc-facts"><dt>Como se fatura</dt><dd>${esc(F.bill)}</dd><dt>Quando se usa</dt><dd>${esc(F.use)}</dd></dl>
        ${edit && st.face !== e.form ? `<button class="btn wide" id="eform">Usar «${esc(F.n)}» neste orçamento</button>` : ''}
      </div>
      <div class="sec-h"><h2>Quem assina</h2></div>
      <div class="card orc-sign">${e.requirements.map((q) => `<div class="orc-req ${q.got >= q.need ? 'ok' : ''}"><div class="grow"><b>${esc(q.label)}</b>
          <small>${q.need === q.approvers.length && q.need > 1 ? 'Todos' : q.need + ' de ' + q.approvers.length}: ${esc((q.names || []).join(', ') || 'ninguém definido')}</small></div>
          <span class="orc-cnt">${q.got}/${q.need}</span></div>`).join('')}
        ${e.signatures.length ? `<ul class="orc-sigs">${e.signatures.map((s) => `<li>${s.approve ? chip('ok', 'Aprovou') : chip('bad', 'Recusou')} <b>${esc(s.name)}</b>${s.for ? ` <small>por ${esc(s.for)} (delegação)</small>` : ''}
          <small>${esc(fmtDate(String(s.at).slice(0, 10)))} · ${eur2(s.price)}</small>${s.note ? `<p class="small">«${esc(s.note)}»</p>` : ''}</li>`).join('')}</ul>` : ''}
        <p class="small muted">${e.status === 'draft' ? 'Quando enviares, o orçamento fica congelado: o preço que se assina é este, ao cêntimo.' : e.status === 'review' ? (e.mine ? 'Fizeste este orçamento: não podes ser tu a assiná-lo.' : reqOk ? '' : 'Cada regra que se aplica tem de ficar completa.') : ''}</p>
        <div class="acts">${edit && can('orcamentos.gerir') ? `<button class="btn big" id="esub" ${e.lines.length ? '' : 'disabled'}>Enviar para assinatura</button>` : ''}
          ${e.can_sign ? `<button class="btn big" id="eok">${ic('ok')}Aprovar ${eur0(t.price)}</button><button class="btn ghost wide" id="eno">Recusar</button>` : ''}
          ${e.can_version ? `<button class="btn ghost wide" id="ever">Fazer nova versão (para mudar)</button>` : ''}</div>
      </div>
    </section></div>`;
  $('#eback').onclick = openEstimates;
  box.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { st.face = b.dataset.f; renderEstimate(); });
  box.querySelectorAll('[data-line]').forEach((b) => b.onclick = () => editLine(e.lines.find((l) => l.id === b.dataset.line)));
  if ($('#eadd')) $('#eadd').onclick = () => editLine(null);
  if ($('#eform')) $('#eform').onclick = () => saveEstimate({ form: st.face });
  if (edit) {
    const knob = (id, key, out) => {
      const inp = $(id);
      inp.oninput = () => {   // a preview while sliding; the database recomputes on release
        const c = Number($('#ecc').value) / 100; const m = Number($('#emg').value) / 100;
        $(out).textContent = nPt(inp.value, 1) + ' %'; $('#eprice').textContent = eur0(Number(t.cost) * (1 + c) / (1 - m));
      };
      inp.onchange = () => saveEstimate({ [key]: Number(inp.value) });
    };
    knob('#ecc', 'contingency_pct', '#eccv'); knob('#emg', 'margin_pct', '#emgv');
    $('#eaace').onchange = (ev) => saveEstimate({ aace_class: Number(ev.target.value) });
    $('#enewc').onchange = (ev) => saveEstimate({ new_client: ev.target.checked });
    $('#enuc').onchange = (ev) => saveEstimate({ nuclear: ev.target.checked });
  }
  if ($('#esub')) $('#esub').onclick = submitEstimate;
  if ($('#eok')) $('#eok').onclick = () => signEstimate(true);
  if ($('#eno')) $('#eno').onclick = () => signEstimate(false);
  if ($('#ever')) $('#ever').onclick = newEstimateVersion;
}
async function saveEstimate(patch) {
  const st = orcState();
  const { error } = await sb.rpc('mini_estimate_update', { p_estimate: st.e.id, p_patch: patch });
  if (error) toast(friendly(error)); else if (patch.form) toast(`Forma de preço: ${EST_FORMS[patch.form].n}. O total não mudou.`);
  viewEstimate(st.e.id);
}
async function editLine(l) {
  const st = orcState(); const kind = l ? l.kind : 'labour';
  const pk = [...new Set(st.e.lines.map((x) => x.package).filter(Boolean))];
  const fd = await askSheet(l ? 'Linha do orçamento' : 'Nova linha', `
    <label>Tipo</label><div class="chips reasons" role="radiogroup">${Object.entries(EST_KIND).map(([k, n]) => `<label class="chip"><input type="radio" name="kind" value="${k}" ${k === kind ? 'checked' : ''} required>${esc(n)}</label>`).join('')}</div>
    <label for="lp">Pacote de trabalho</label><input id="lp" name="package" list="lpl" maxlength="120" value="${esc(l ? l.package || '' : '')}" placeholder="ex.: Montagem de instrumentos">
    <datalist id="lpl">${pk.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
    <label for="ld">Descrição</label><input id="ld" name="description" required maxlength="200" value="${esc(l ? l.description : '')}">
    <div class="row"><div><label for="lq">Quantidade</label><input id="lq" name="qty" required inputmode="decimal" value="${esc(l ? nPt(l.qty, 3).replace(/\s/g, '') : '')}"></div>
      <div><label for="lu">Unidade</label><input id="lu" name="unit" maxlength="12" value="${esc(l ? l.unit : 'un')}" placeholder="un, m, sem, vg"></div></div>
    <div class="row" id="llab"><div><label for="lh">Horas por unidade</label><input id="lh" name="hpu" inputmode="decimal" value="${esc(l && l.hours_per_unit != null ? nPt(l.hours_per_unit, 3).replace(/\s/g, '') : '')}"></div>
      <div><label for="lc">Categoria</label><input id="lc" name="category" maxlength="60" value="${esc(l ? l.category || '' : '')}" placeholder="ex.: Instrumentista"></div></div>
    <label for="lr" id="lrl">Custo por hora (€)</label><input id="lr" name="rate" required inputmode="decimal" value="${esc(l ? nPt(l.cost_rate, 2).replace(/\s/g, '') : '')}">
    <p class="small muted">Custo, não preço: o que isto nos custa. O preço sai da contingência e da margem.</p>
    ${l ? '<button class="btn ghost wide danger-t" value="del" formnovalidate>Apagar esta linha</button>' : ''}`, 'Guardar', (d) => {
    const sync = () => { const lab = d.querySelector('input[name=kind]:checked').value === 'labour';
      d.querySelector('#llab').hidden = !lab; d.querySelector('#lh').required = lab; d.querySelector('#lrl').textContent = lab ? 'Custo por hora (€)' : 'Custo por unidade (€)'; };
    d.querySelectorAll('input[name=kind]').forEach((r) => r.onchange = sync); sync();
  });
  if (!fd) return;
  if (fd.get('_v') === 'del') {
    const { error } = await sb.rpc('mini_estimate_line_delete', { p_line: l.id });
    if (error) return toast(friendly(error));
    toast('Linha apagada.'); return viewEstimate(st.e.id);
  }
  const n = (k) => { const s = String(fd.get(k) || '').replace(/\s/g, '').replace(',', '.'); return s === '' ? null : Number(s); };
  if ([n('qty'), n('rate')].some((x) => x === null || !Number.isFinite(x) || x < 0) || (fd.get('kind') === 'labour' && !(n('hpu') >= 0))) return toast('Escreve números válidos (podes usar vírgula).');
  const line = { id: l ? l.id : null, kind: fd.get('kind'), package: fd.get('package'), description: fd.get('description'), qty: n('qty'), unit: fd.get('unit'),
    hours_per_unit: n('hpu'), category: fd.get('category'), cost_rate: n('rate') };
  const { error } = await sb.rpc('mini_estimate_line_save', { p_estimate: st.e.id, p_line: line });
  if (error) return toast(friendly(error));
  viewEstimate(st.e.id);
}
async function submitEstimate() {
  const e = orcState().e;
  const fd = await askSheet('Enviar para assinatura', `<p>O orçamento fica congelado com o preço de <b>${eur2(e.totals.price)}</b>, na forma «${esc(EST_FORMS[e.form].n)}».</p>
    <p class="small muted">Para mudar depois, faz-se uma nova versão, que volta a precisar das assinaturas. Assina quem as regras da empresa disserem.</p>`, 'Enviar');
  if (!fd) return;
  const { error } = await sb.rpc('mini_estimate_submit', { p_estimate: e.id });
  if (error) return toast(friendly(error));
  toast('Enviado. Quem tem de assinar já o vê na lista.'); viewEstimate(e.id);
}
async function signEstimate(ok) {
  const e = orcState().e;
  const fd = await askSheet(ok ? 'Aprovar o orçamento' : 'Recusar o orçamento', `<p>${esc(estNo(e))} · ${esc(e.title)}<br><b>${eur2(e.totals.price)}</b> · ${esc(EST_FORMS[e.form].n)} · margem ${nPt(e.margin_pct, 1)} %</p>
    <label for="sn">${ok ? 'Nota (opcional)' : 'Porquê? *'}</label><input id="sn" name="note" maxlength="300" ${ok ? '' : 'required minlength="5"'}>
    <p class="small muted">A tua assinatura fica guardada com o preço, a hora e o teu nome. Não se apaga.</p>`, ok ? 'Aprovar' : 'Recusar');
  if (!fd) return;
  const { data, error } = await sb.rpc('mini_estimate_sign', { p_estimate: e.id, p_approve: ok, p_note: String(fd.get('note') || '').trim() || null });
  if (error) return toast(friendly(error));
  toast(data === 'approved' ? 'Aprovado. O preço está fechado.' : data === 'rejected' ? 'Recusado. Quem o fez pode fazer uma nova versão.' : 'Assinado. Ainda faltam assinaturas.');
  viewEstimate(e.id);
}
async function newEstimateVersion() {
  const st = orcState();
  const { data, error } = await sb.rpc('mini_estimate_new_version', { p_estimate: st.e.id });
  if (error) return toast(friendly(error));
  toast('Nova versão em rascunho. A anterior fica guardada.'); st.id = data; viewEstimate(data);
}

// Who signs, per company: rules (value, margin, form, new client, nuclear) → named people and how many of them.
// Every rule that matches must be met; one rule must cover any value, so no estimate is left without signers.
const EST_TEMPLATES = {
  one: { n: 'Uma pessoa assina', make: (p) => [{ label: 'Qualquer valor', approvers: p.slice(0, 1), need: 1 }] },
  two: { n: 'Dois responsáveis, basta um', make: (p) => [{ label: 'Qualquer valor', approvers: p.slice(0, 2), need: 1 },
    { label: 'Acima de 250 000 €: os dois', min_value: 250000, approvers: p.slice(0, 2), need: Math.min(2, p.slice(0, 2).length) },
    { label: 'Margem abaixo de 8 %: os dois', margin_below: 8, approvers: p.slice(0, 2), need: Math.min(2, p.slice(0, 2).length) }] },
  lvl: { n: 'Três níveis por valor', make: (p) => [{ label: 'Qualquer valor', approvers: p.slice(0, 1), need: 1 },
    { label: 'Acima de 100 000 €', min_value: 100000, approvers: p.slice(0, 2), need: Math.min(2, p.slice(0, 2).length) },
    { label: 'Acima de 1 000 000 €', min_value: 1000000, approvers: p.slice(0, 3), need: Math.min(2, p.slice(0, 3).length) }] },
};
function ruleWhen(r) {
  const w = [];
  if (r.min_value != null) w.push('a partir de ' + eur0(r.min_value));
  if (r.max_value != null) w.push('até ' + eur0(r.max_value));
  if (r.margin_below != null) w.push('margem abaixo de ' + nPt(r.margin_below, 1) + ' %');
  if (r.forms && r.forms.length) w.push(r.forms.map((f) => EST_FORMS[f].n).join(' ou '));
  if (r.new_client_only) w.push('cliente novo');
  if (r.nuclear_only) w.push('obra nuclear');
  return w.length ? w.join(' · ') : 'Qualquer valor';
}
async function viewEstimateRules() {
  const st = orcState();
  app.innerHTML = `<button class="btn ghost small orc-back" id="eback">← Orçamentos</button>
    <div class="ph"><div><p class="ph-k">Matriz de autoridade · ISO 9001 §5.3</p><h1>Quem assina</h1></div></div>
    <p class="muted lead">Cada empresa decide quem assina os orçamentos e quando. Todas as regras que se aplicam a um orçamento têm de ficar completas. Quem fez o orçamento nunca conta.</p>
    <div id="erl">${skel(3)}</div>`;
  $('#eback').onclick = openEstimates;
  const { data, error } = await sb.rpc('mini_estimate_rules');
  const el = $('#erl'); if (!el) return;
  if (error) { el.innerHTML = `<div class="card"><p>${esc(friendly(error))}</p></div>`; return; }
  st.r = { ...data, draft: data.rules.map((r) => ({ ...r })), formsDraft: [...data.forms], dirty: false };
  renderEstimateRules();
}
function renderEstimateRules() {
  const st = orcState(); const R = st.r; const el = $('#erl'); if (!el) return;
  const edit = R.can_edit; const signers = R.people.filter((p) => p.can_sign);
  const name = (id) => (R.people.find((p) => p.id === id) || {}).name || '?';
  el.innerHTML = `<div class="sec-h"><h2>Formas de preço usadas</h2></div>
    <div class="chips" role="group">${Object.entries(EST_FORMS).map(([k, f]) => `<button type="button" class="chip" data-form="${k}" aria-pressed="${R.formsDraft.includes(k)}" ${edit ? '' : 'disabled'}>${esc(f.n)}</button>`).join('')}</div>
    <div class="sec-h"><h2>Regras</h2></div>
    ${edit ? `<p class="small muted">Começa por um modelo e acerta as pessoas:</p><div class="chips">${Object.entries(EST_TEMPLATES).map(([k, t]) => `<button type="button" class="chip" data-tpl="${k}">${esc(t.n)}</button>`).join('')}</div>` : ''}
    ${R.draft.length ? '' : `<div class="card"><p>Sem regras: assina um administrador da empresa.</p></div>`}
    <div class="orc-rules">${R.draft.map((r, i) => `<div class="card orc-rule"><div class="grow"><b>${esc(r.label || 'Regra')}</b><small class="muted">${esc(ruleWhen(r))}</small>
        <small>${r.need === r.approvers.length && r.need > 1 ? 'Todos' : r.need + ' de ' + r.approvers.length}: ${esc(r.approvers.map(name).join(', '))}</small></div>
        ${edit ? `<button class="btn ghost small" data-edit="${i}">Mudar</button>` : ''}</div>`).join('')}</div>
    ${edit ? `<div class="acts"><button class="btn ghost" id="radd">+ Regra</button><button class="btn" id="rsave" ${R.dirty ? '' : 'disabled'}>Guardar regras</button></div>
      ${signers.length ? '' : '<p class="small muted">Ninguém tem ainda o direito de assinar orçamentos. Dá-o em Secretaria › Departamentos e acessos («Aprovar o preço»).</p>'}` : '<p class="small muted">Só quem tem «Definir quem assina» pode mudar as regras.</p>'}
    <div class="sec-h"><h2>Férias: delegar a assinatura</h2></div>
    <div class="card">${R.delegations.length ? `<ul class="orc-sigs">${R.delegations.map((d) => `<li><b>${esc(d.from)}</b> → ${esc(d.to)} <small>até ${esc(fmtDate(d.until))}</small></li>`).join('')}</ul>` : '<p class="small muted">Nenhuma delegação em vigor.</p>'}
      ${can('orcamentos.aprovar') ? '<button class="btn ghost wide" id="rdel">Delegar a minha assinatura</button>' : ''}
      <p class="small muted">Acaba sozinha na data marcada (no máximo 90 dias). Quem recebe assina em teu nome, e fica escrito.</p></div>`;
  el.querySelectorAll('[data-form]').forEach((b) => b.onclick = () => {
    const k = b.dataset.form; R.formsDraft = R.formsDraft.includes(k) ? R.formsDraft.filter((x) => x !== k) : [...R.formsDraft, k];
    if (!R.formsDraft.length) { R.formsDraft = [k]; toast('Fica pelo menos uma forma de preço.'); }
    R.dirty = true; renderEstimateRules();
  });
  el.querySelectorAll('[data-tpl]').forEach((b) => b.onclick = () => {
    if (!signers.length) return toast('Primeiro dá a alguém o direito de assinar (Departamentos e acessos).');
    R.draft = EST_TEMPLATES[b.dataset.tpl].make(signers.map((p) => p.id)); R.dirty = true; renderEstimateRules();
  });
  el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => editRule(Number(b.dataset.edit)));
  if ($('#radd')) $('#radd').onclick = () => editRule(-1);
  if ($('#rsave')) $('#rsave').onclick = saveRules;
  if ($('#rdel')) $('#rdel').onclick = delegateSignature;
}
async function editRule(i) {
  const R = orcState().r; const r = i >= 0 ? R.draft[i] : { label: '', approvers: [], need: 1 };
  const signers = R.people.filter((p) => p.can_sign || r.approvers.includes(p.id));
  const v = (x) => (x == null ? '' : String(x).replace('.', ','));
  const fd = await askSheet(i >= 0 ? 'Mudar a regra' : 'Nova regra', `
    <label for="rl">Nome</label><input id="rl" name="label" required maxlength="80" value="${esc(r.label)}" placeholder="ex.: Acima de 500 000 €">
    <p class="small muted">Quando se aplica (deixa em branco o que não interessa; tudo em branco = qualquer valor):</p>
    <div class="row"><div><label for="rmin">Preço a partir de (€)</label><input id="rmin" name="min" inputmode="decimal" value="${esc(v(r.min_value))}"></div>
      <div><label for="rmax">Preço até (€)</label><input id="rmax" name="max" inputmode="decimal" value="${esc(v(r.max_value))}"></div></div>
    <label for="rmg">Margem abaixo de (%)</label><input id="rmg" name="mg" inputmode="decimal" value="${esc(v(r.margin_below))}">
    <label>Só nestas formas de preço</label><div class="chips reasons">${Object.entries(EST_FORMS).map(([k, f]) => `<label class="chip"><input type="checkbox" name="forms" value="${k}" ${(r.forms || []).includes(k) ? 'checked' : ''}>${esc(f.n)}</label>`).join('')}</div>
    <label class="check inline"><input type="checkbox" name="nc" ${r.new_client_only ? 'checked' : ''}> Só cliente novo</label>
    <label class="check inline"><input type="checkbox" name="nu" ${r.nuclear_only ? 'checked' : ''}> Só obra nuclear</label>
    <label>Quem pode assinar</label><div class="chips reasons">${signers.map((p) => `<label class="chip"><input type="checkbox" name="who" value="${esc(p.id)}" ${r.approvers.includes(p.id) ? 'checked' : ''}>${esc(p.name)}</label>`).join('') || '<p class="small muted">Ninguém tem o direito de assinar orçamentos.</p>'}</div>
    <label for="rneed">Quantas assinaturas são precisas</label><input id="rneed" name="need" type="number" min="1" max="9" required value="${esc(r.need)}">
    ${i >= 0 ? '<button class="btn ghost wide danger-t" value="del" formnovalidate>Apagar esta regra</button>' : ''}`, 'OK');
  if (!fd) return;
  if (fd.get('_v') === 'del') { R.draft.splice(i, 1); R.dirty = true; return renderEstimateRules(); }
  const n = (k) => { const s = String(fd.get(k) || '').replace(/\s/g, '').replace(',', '.'); return s === '' ? null : Number(s); };
  const who = fd.getAll('who'); const need = Number(fd.get('need'));
  if (!who.length) return toast('Escolhe pelo menos uma pessoa.');
  if (need > who.length) return toast(`Pedes ${need} assinaturas mas só escolheste ${who.length} pessoa(s).`);
  const forms = fd.getAll('forms');
  const nr = { label: String(fd.get('label')).trim(), min_value: n('min'), max_value: n('max'), margin_below: n('mg'), forms: forms.length ? forms : null,
    new_client_only: !!fd.get('nc'), nuclear_only: !!fd.get('nu'), approvers: who, need };
  if (i >= 0) R.draft[i] = nr; else R.draft.push(nr);
  R.dirty = true; renderEstimateRules();
}
async function saveRules() {
  const R = orcState().r;
  if (!R.draft.some((r) => r.min_value == null && r.max_value == null && r.margin_below == null && !(r.forms && r.forms.length) && !r.new_client_only && !r.nuclear_only)) {
    return toast('Falta uma regra «qualquer valor», para nenhum orçamento ficar sem quem assine.');
  }
  const rules = R.draft.map((r) => ({ label: r.label, min_value: r.min_value, max_value: r.max_value, margin_below: r.margin_below, forms: r.forms && r.forms.length ? r.forms : null,
    new_client_only: !!r.new_client_only, nuclear_only: !!r.nuclear_only, approvers: r.approvers, need: r.need }));
  const { error } = await sb.rpc('mini_estimate_rules_save', { p_rules: rules, p_forms: R.formsDraft });
  if (error) return toast(friendly(error));
  toast('Regras guardadas. Valem para os orçamentos enviados a partir de agora.'); viewEstimateRules();
}
async function delegateSignature() {
  const R = orcState().r;
  const others = R.people.filter((p) => p.can_sign && p.id !== state.me.user_id);
  if (!others.length) return toast('Não há mais ninguém com o direito de assinar orçamentos.');
  const max = isoDay(new Date(Date.now() + 90 * 86400000)); const min = isoDay(new Date());
  const fd = await askSheet('Delegar a minha assinatura', `
    <label>Para quem</label><div class="chips reasons" role="radiogroup">${others.map((p, i) => `<label class="chip"><input type="radio" name="to" value="${esc(p.id)}" ${i ? '' : 'required'}>${esc(p.name)}</label>`).join('')}</div>
    <label for="du">Até</label><input id="du" name="until" type="date" required min="${min}" max="${max}">`, 'Delegar');
  if (!fd) return;
  const { error } = await sb.rpc('mini_estimate_delegate', { p_to: fd.get('to'), p_until: fd.get('until') });
  if (error) return toast(friendly(error));
  toast('Delegado. Acaba sozinho nessa data.'); viewEstimateRules();
}

// ------------------------------------------------------------------ LMRA (sql/64): the last-minute risk check, before the work starts
// The team leader answers the questions on the spot; every «Não» stops the work (a stop-work order, the safety team is told).
// When all is «Sim», each person of the team taps their card to sign. A blocked person (documents) cannot sign.
const canLmra = () => can('seguranca.lmra') || can('seguranca.parar_obra');
const canEmergency = () => can('seguranca.emergencia');
function viewLmra() {
  if (!canLmra()) return viewClock();   // code guard as well as the database's
  app.innerHTML = `<div class="ph"><div><p class="ph-k">Antes de começar o trabalho</p><h1>LMRA</h1></div></div>
    <p class="muted lead">Análise de risco de última hora. Respondes no local, com a equipa. Um «Não» para o trabalho; com tudo «Sim», cada pessoa encosta o cartão para assinar.</p>
    <div class="team-site">${siteSelect('lsite')}</div>
    <div id="lbody">${skel(3)}</div>`;
  bindSiteSelect('lsite', loadLmra);
  loadLmra();
  state.timer = setInterval(() => { if (state.view === 'lmra' && !state.lmraForm && !state.nfc && document.visibilityState === 'visible') loadLmra(); }, 60000);
}
async function loadLmra() {
  const el = $('#lbody'); const site = currentSite(); if (!el) return;
  if (!site) { el.innerHTML = `<div class="card">${empty('helmet', 'Sem obras abertas', 'Abre uma obra em Obras.')}</div>`; return; }
  const { data: d, error } = await sb.rpc('mini_lmra_day', { p_site: site.id });
  if (!el.isConnected) return;
  if (error) { el.innerHTML = `<p>${esc(friendly(error))}</p>`; return; }
  state.lmra = d; const tz = siteTz(site.id);
  const un = d.inside_unsigned || [];
  el.innerHTML = `${d.stops.map((w) => `<div class="alert bad lm-stop">${ic('warn')}<div class="grow"><b>TRABALHO PARADO</b><span>${esc(stopText(w.reason))} · ${esc(fmtHour(w.at, tz))}</span></div>
        ${d.can_lift ? `<button class="btn small ghost" data-lift="${esc(w.id)}">Levantar</button>` : ''}</div>`).join('')}
    <div class="kpis team-kpis">
      <div class="kpi"><b>${d.on_site}</b><span>na obra agora</span></div>
      <div class="kpi ${d.signed_today ? 'ok' : ''}"><b>${d.signed_today}</b><span>assinaram hoje</span></div>
      <div class="kpi ${un.length ? 'warn' : 'ok'}"><b>${un.length}</b><span>dentro sem LMRA</span></div></div>
    ${un.length ? `<p class="small muted">${ic('warn')} Dentro sem LMRA assinado: ${esc(un.join(', '))}.</p>` : ''}
    ${d.can_do ? `<button class="btn big" id="lnew">${ic('ok')}Fazer LMRA agora</button>` : ''}
    <div id="lform"></div>
    <div class="sec-h"><h2 class="eyebrow">LMRA de hoje</h2></div>
    ${d.records.length ? `<div class="list">${d.records.map((r) => `<article class="card lm-rec ${r.safe ? 'ok' : 'bad'}">
        <div class="wk"><span class="lm-dot">${ic(r.safe ? 'ok' : 'x')}</span><div class="grow"><div class="nm">${esc(r.place)}${r.task ? ' · ' + esc(r.task) : ''}</div>
          <div class="sub">${esc(fmtHour(r.at, tz))} · ${esc(r.leader || '')}</div></div>
          ${r.safe ? chip('ok', r.signed.length + ' assinaram', 'ok') : chip('bad', 'parado', 'x')}</div>
        ${!r.safe ? `<p class="small" style="margin:8px 0 0">Falhou: ${esc((r.failed || []).map((c) => lmraQ(c)).join(' · '))}</p>` : ''}
        ${r.signed.length ? `<p class="small muted" style="margin:8px 0 0">${esc(r.signed.map((s) => s.name).join(', '))}</p>` : ''}
        ${r.safe && d.can_do ? `<button class="btn ghost small" data-sign="${esc(r.id)}">${ic('card')}Assinar com cartão</button>` : ''}</article>`).join('')}</div>`
      : `<div class="card">${empty('check', 'Ainda sem LMRA hoje', d.can_do ? 'Carrega em «Fazer LMRA agora» antes de começar.' : 'O encarregado faz o LMRA antes de começar.')}</div>`}`;
  if ($('#lnew')) $('#lnew').onclick = () => lmraForm(site);
  el.querySelectorAll('[data-sign]').forEach((b) => b.onclick = () => lmraSign(b.dataset.sign, b.closest('.lm-rec')));
  el.querySelectorAll('[data-lift]').forEach((b) => b.onclick = () => liftStop(b.dataset.lift));
}
// The stop order says «LMRA NOK: isolation, ppe»: show the questions instead of the codes.
const stopText = (r) => { const m = /^LMRA NOK:\s*(.*)$/.exec(r || ''); return m ? 'LMRA com «Não»: ' + m[1].split(/,\s*/).map((c) => lmraQ(c)).join(' · ') : r; };
const lmraQ = (code) => { const it = ((state.lmra && state.lmra.template.items) || []).find((i) => i.code === code); return it ? it.question : code; };
function lmraForm(site) {
  const box = $('#lform'); const items = state.lmra.template.items; state.lmraForm = true;
  $('#lnew').hidden = true;
  box.innerHTML = `<form class="card lm-form" id="lf"><h2 style="margin-top:0">${esc(state.lmra.template.name)}</h2>
    <label for="lp">Onde é o trabalho? *</label><input id="lp" name="place" required minlength="2" maxlength="255" placeholder="ex.: Bomba P-101, piso 2">
    <label for="lt">Que trabalho?</label><input id="lt" name="task" maxlength="200" placeholder="ex.: trocar o vedante">
    <ol class="lm-q">${items.map((i) => `<li data-code="${esc(i.code)}"><span>${esc(i.question)}</span>
      <div class="yn" role="radiogroup"><label class="y"><input type="radio" name="${esc(i.code)}" value="1" required>Sim</label>
      <label class="n"><input type="radio" name="${esc(i.code)}" value="0">Não</label></div></li>`).join('')}</ol>
    <p class="small muted">Um «Não» numa pergunta crítica para o trabalho e avisa a segurança.</p>
    <div class="acts"><button class="btn big">Gravar LMRA</button><button class="btn ghost wide" type="button" id="lcancel">Cancelar</button></div></form>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#lcancel').onclick = () => { state.lmraForm = false; loadLmra(); };
  $('#lf').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target; const fd = new FormData(f); const answers = {};
    for (const i of items) answers[i.code] = fd.get(i.code) === '1';
    f.querySelector('button.big').disabled = true;
    let pos = null;
    try { pos = await new Promise((ok) => { if (!navigator.geolocation) return ok(null); navigator.geolocation.getCurrentPosition((p) => ok(p.coords), () => ok(null), { timeout: 4000, maximumAge: 300000 }); }); } catch (_) { pos = null; }
    const { data, error } = await sb.rpc('mini_lmra_save', { p_site: site.id, p_place: String(fd.get('place')).trim(), p_task: String(fd.get('task') || '').trim(),
      p_answers: answers, p_lat: pos ? +pos.latitude.toFixed(6) : null, p_lng: pos ? +pos.longitude.toFixed(6) : null });
    state.lmraForm = false;
    if (error) { f.querySelector('button.big').disabled = false; return toast(friendly(error)); }
    if (data.safe) { beep(true); showFlash('ok', 'PODE TRABALHAR', 'Agora cada pessoa encosta o cartão para assinar.'); await loadLmra(); lmraSign(data.id); }
    else { beep(false); showFlash('bad', 'PARAR', 'Não começar. A segurança foi avisada.'); loadLmra(); }
  };
}
// Signing: the leader's phone reads each card in turn (or the number typed). A signature is one person, once.
function lmraSign(id, anchor) {
  stopNfc(); const nfcOk = 'NDEFReader' in window;
  const d = document.createElement('dialog'); d.className = 'dlg';
  d.innerHTML = `<form method="dialog"><h2>Assinar o LMRA</h2><p class="small muted">Cada pessoa da equipa encosta o cartão. Quem tem documentos em falta não pode assinar.</p>
    ${nfcOk ? `<button class="tapzone reading" type="button" id="snfc"><span class="ring">${ic('tap')}</span><b>Encoste o cartão</b></button>` : ''}
    <div class="manual"><input id="suid" autocomplete="off" autocapitalize="characters" placeholder="Número do cartão"><button class="btn ghost" type="button" id="sgo">Assinar</button></div>
    <div id="sres" aria-live="polite"></div><ul class="lm-signed" id="slist"></ul>
    <div class="acts"><button class="btn big" value="ok">Terminar</button></div></form>`;
  document.body.appendChild(d); d.showModal();
  const res = d.querySelector('#sres'); const list = d.querySelector('#slist'); let last = { uid: '', at: 0 }; let ctrl = null;
  const sign = async (raw) => {
    const uid = normUid(raw); if (!uid) return;
    if (uid === last.uid && Date.now() - last.at < 3000) return; last = { uid, at: Date.now() };
    const { data, error } = await sb.rpc('mini_lmra_sign', { p_lmra: id, p_uid: uid });
    if (error) { beep(false); res.innerHTML = `<div class="result bad">${ic('x')}<div><b>Não assinou</b>${esc(friendly(error))}</div></div>`; return; }
    beep(true);
    res.innerHTML = `<div class="result ok">${ic('ok')}<div><b>${esc(data.name)}</b>${data.again ? 'Já tinha assinado.' : 'Assinou.'}</div></div>`;
    if (!data.again) list.insertAdjacentHTML('afterbegin', `<li>${ic('ok')}${esc(data.name)}</li>`);
  };
  if (nfcOk) (async () => {
    try { ctrl = new AbortController(); const r = new NDEFReader(); await r.scan({ signal: ctrl.signal });
      r.onreading = (ev) => sign(ev.serialNumber); r.onreadingerror = () => { beep(false); res.innerHTML = `<div class="result bad">${ic('x')}<div><b>NÃO LIDO</b>Encosta outra vez, devagar.</div></div>`; };
    } catch (err) { res.innerHTML = `<div class="result warn">${ic('warn')}<div><b>O leitor não ligou</b>${esc(err.name === 'NotAllowedError' ? 'Dá permissão ao NFC no Chrome.' : 'Escreve o número do cartão.')}</div></div>`; }
  })();
  d.querySelector('#sgo').onclick = () => { const i = d.querySelector('#suid'); sign(i.value); i.value = ''; i.focus(); };
  d.querySelector('#suid').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); d.querySelector('#sgo').click(); } };
  d.addEventListener('close', () => { if (ctrl) ctrl.abort(); d.remove(); if (state.view === 'lmra') loadLmra(); });
}
async function liftStop(id) {
  const fd = await askSheet('Levantar a paragem', `<p class="small muted">O trabalho só recomeça quando o risco estiver resolvido. Fica registado com o teu nome.</p>
    <label for="lr">O que foi resolvido? *</label><textarea id="lr" name="r" required minlength="10" maxlength="500" placeholder="ex.: luvas novas entregues, área isolada"></textarea>`, 'Levantar');
  if (!fd) return;
  const { error } = await sb.rpc('mini_stop_work_lift', { p_stop: id, p_reason: String(fd.get('r')).trim() });
  if (error) return toast(friendly(error));
  toast('Paragem levantada. Façam um LMRA novo antes de recomeçar.'); loadLmra();
}

// ------------------------------------------------------------------ Emergência (sql/64): counting people at the assembly points
// Who was inside when it started is frozen; each person taps their card at their assembly point (one site can have many).
// Without network the taps wait on this phone and go when it comes back (the server keeps the time of the tap).
const MUSTER_Q = 'gn.muster.q';
const EMER_KIND = { fire: 'Incêndio', gas_leak: 'Fuga de gás', explosion: 'Explosão', chemical: 'Derrame químico', drill: 'Simulacro', other: 'Outra' };
function viewEmergency() {
  if (!canEmergency()) return viewClock();   // code guard as well as the database's
  app.innerHTML = `<div class="ph"><div><p class="ph-k">Contagem no ponto de encontro</p><h1>Emergência</h1></div></div>
    <div class="team-site">${siteSelect('esite')}</div><div id="ebody">${skel(3)}</div>`;
  bindSiteSelect('esite', () => { stopNfc(); loadEmergency(); });
  loadEmergency();
  state.timer = setInterval(() => { if (state.view === 'emergencia' && document.visibilityState === 'visible') loadEmergency(); }, 5000);
}
async function flushMuster() {
  const q = load(MUSTER_Q, []); if (!q.length || state.offline || navigator.onLine === false) return;
  const left = [];
  for (const x of q) {
    const { error } = await sb.rpc('mini_muster_scan', x);
    if (error && /fetch|network|Failed/i.test(error.message || '')) left.push(x);
  }
  store(MUSTER_Q, left);
}
let emerSeq = 0;
async function loadEmergency() {
  const el = $('#ebody'); const site = currentSite(); if (!el) return;
  if (!site) { el.innerHTML = `<div class="card">${empty('helmet', 'Sem obras abertas', 'Abre uma obra em Obras.')}</div>`; return; }
  await flushMuster();
  const seq = ++emerSeq; const ck = 'gn.emer.' + site.id;
  let d = null; let error = null; let cached = false;
  if (!state.offline && navigator.onLine !== false) ({ data: d, error } = await sb.rpc('mini_emergency', { p_site: site.id }));
  if (seq !== emerSeq || !el.isConnected) return;
  // Without network: the last list this phone saw, so the count can go on (the taps wait here).
  if (!d && (!error || /fetch|network|Failed/i.test(error.message || ''))) { const c = load(ck, null); if (c) { d = c.d; cached = c.at; error = null; } }
  if (error || !d) { el.innerHTML = `<p>${esc(error ? friendly(error) : 'Sem rede e sem lista guardada neste telemóvel.')}</p>`; return; }
  if (!cached) store(ck, { d, at: Date.now() });
  state.emer = d; const tz = siteTz(site.id); const ev = d.event;
  const pending = load(MUSTER_Q, []).filter((x) => ev && x.p_event === ev.id).length;
  if (!ev) {
    stopNfc();
    el.innerHTML = `<div class="em-idle card"><p class="muted" style="margin-top:0">Na obra agora: <b>${d.on_site}</b> pessoa(s). Quando começas, a lista de quem está dentro fica congelada e cada pessoa pica no ponto de encontro.</p>
      <button class="btn big danger em-start" id="estart">${ic('warn')}COMEÇAR EMERGÊNCIA</button>
      <button class="btn ghost wide" id="edrill">${ic('play')}Fazer um simulacro</button></div>
      <div class="sec-h"><h2 class="eyebrow">Pontos de encontro desta obra</h2><button class="btn ghost small" id="eadd">+ Ponto</button></div>
      <div class="card">${d.points.length ? `<ul class="em-points">${d.points.map((p) => `<li><b>${esc(p.code)}</b> ${esc(p.name)}</li>`).join('')}</ul>`
        : '<p class="small muted" style="margin:0">Ainda sem pontos. Se começares uma emergência, a app cria o «Ponto de encontro principal».</p>'}</div>
      ${d.last ? `<p class="small muted">Última: ${esc(EMER_KIND[d.last.kind] || d.last.kind)} em ${esc(fmtTime(d.last.started, tz))}, fechada às ${esc(fmtHour(d.last.ended, tz))}.</p>` : ''}`;
    $('#estart').onclick = () => startEmergency(site, false);
    $('#edrill').onclick = () => startEmergency(site, true);
    $('#eadd').onclick = () => addPoint(site);
    return;
  }
  const people = ev.people || []; const safe = people.filter((p) => p.safe); const missing = people.filter((p) => !p.safe);
  const pts = d.points; if (!pts.find((p) => p.id === state.emerPoint)) state.emerPoint = (pts[0] || {}).id;
  const nfcOk = 'NDEFReader' in window; const lastRes = ($('#result') || {}).innerHTML || '';
  el.innerHTML = `<section class="em-live ${ev.kind === 'drill' ? 'drill' : ''}">
      <div class="em-h">${ic('warn')}<div class="grow"><b>${ev.kind === 'drill' ? 'SIMULACRO' : 'EMERGÊNCIA'} · ${esc(EMER_KIND[ev.kind] || ev.kind)}</b>
        <small>desde as ${esc(fmtHour(ev.started, tz))}${ev.by ? ' · ' + esc(ev.by) : ''}</small></div></div>
      <div class="em-count"><div class="${missing.length ? 'miss' : 'all'}"><b>${missing.length}</b><span>em falta</span></div><div><b>${safe.length}<small>/${people.length}</small></b><span>no ponto de encontro</span></div></div>
      <label>Estou no ponto</label><div class="chips em-pts" role="radiogroup">${pts.map((p) => `<button type="button" class="chip ${p.id === state.emerPoint ? 'on' : ''}" data-pt="${esc(p.id)}">${esc(p.code)} · ${esc(p.name)}</button>`).join('')}
        <button type="button" class="chip" id="eadd">+ Ponto</button></div>
      ${nfcOk ? `<button class="tapzone ${state.nfc ? 'reading' : ''}" id="nfc" aria-pressed="${state.nfc ? 'true' : 'false'}"><span class="ring">${ic('tap')}</span><b id="nfclbl">${state.nfc ? 'Encoste o cartão' : 'Tocar para ligar o leitor'}</b>
        <span class="small" id="nfchelp">${state.nfc ? 'Cada pessoa encosta o cartão ao chegar ao ponto.' : 'Depois cada pessoa encosta o cartão.'}</span></button>` : ''}
      <form class="manual" id="emanual"><input id="euid" autocomplete="off" autocapitalize="characters" placeholder="Número do cartão"><button class="btn ghost">Picar</button></form>
      <div id="result" aria-live="polite">${lastRes}</div>
      ${cached ? `<div class="result warn">${ic('cloud')}<div><b>Sem rede</b>Lista de ${esc(new Date(cached).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }))}. As picagens ficam guardadas e vão quando a rede voltar.</div></div>` : ''}
      ${pending ? `<p class="small">${ic('cloud')} ${pending} picagem(ns) à espera de rede neste telemóvel.</p>` : ''}
    </section>
    ${missing.length ? `<div class="sec-h"><h2 class="eyebrow" style="color:var(--bad)">Em falta (${missing.length})</h2></div>
      <div class="card em-list">${missing.map((p) => `<div class="em-p miss">${avatar(p.name)}<div class="grow"><b>${esc(p.name)}</b><small>visto às ${esc(fmtHour(p.last_seen, tz))}</small></div>
        ${p.phone ? `<a class="btn ghost small" href="tel:${esc(String(p.phone).replace(/[^\d+]/g, ''))}">${ic('phone')}Ligar</a>` : ''}
        <button class="btn ghost small" data-mark="${esc(p.id)}" data-name="${esc(p.name)}">Está salvo</button></div>`).join('')}</div>`
      : `<div class="alert ok">${ic('ok')}<div><b>Todos contados.</b> Ninguém em falta.</div></div>`}
    ${(ev.extra || []).length ? `<p class="small muted">Picaram sem estarem na lista: ${esc(ev.extra.join(', '))}.</p>` : ''}
    ${safe.length ? `<div class="sec-h"><h2 class="eyebrow">No ponto de encontro (${safe.length})</h2></div>
      <div class="card em-list">${safe.map((p) => `<div class="em-p">${avatar(p.name)}<div class="grow"><b>${esc(p.name)}</b><small>${esc(p.point || '')} · ${esc(fmtHour(p.at, tz))}${p.manual ? ' · marcado à mão' : ''}</small></div>${chip('ok', 'salvo', 'ok')}</div>`).join('')}</div>` : ''}
    <button class="btn ghost wide" id="eend" style="margin-top:16px">Terminar ${ev.kind === 'drill' ? 'simulacro' : 'emergência'}</button>`;
  el.querySelectorAll('[data-pt]').forEach((b) => b.onclick = () => { state.emerPoint = b.dataset.pt; el.querySelectorAll('[data-pt]').forEach((x) => x.classList.toggle('on', x === b)); });
  $('#eadd').onclick = () => addPoint(site);
  if (nfcOk) $('#nfc').onclick = () => (state.nfc ? stopNfc() : musterNfc());
  $('#emanual').onsubmit = (e) => { e.preventDefault(); const i = $('#euid'); musterTap(i.value); i.value = ''; i.focus(); };
  el.querySelectorAll('[data-mark]').forEach((b) => b.onclick = () => markSafe(b.dataset.mark, b.dataset.name));
  $('#eend').onclick = () => endEmergency(ev);
}
async function musterNfc() {
  try {
    const ctrl = new AbortController(); const reader = new NDEFReader();
    await reader.scan({ signal: ctrl.signal }); state.nfc = ctrl; nfcLook(true);
    $('#nfchelp').textContent = 'Cada pessoa encosta o cartão ao chegar ao ponto.';
    let last = { uid: '', at: 0 };
    reader.onreading = (ev) => { const uid = normUid(ev.serialNumber); if (!uid || (uid === last.uid && Date.now() - last.at < 3000)) return; last = { uid, at: Date.now() }; musterTap(uid); };
    reader.onreadingerror = () => { beep(false); showResult('bad', 'NÃO LIDO', 'Encosta outra vez, devagar.'); };
  } catch (err) { toast(err.name === 'NotAllowedError' ? 'Dá permissão ao NFC no Chrome.' : 'O NFC não arrancou: ' + err.message); }
}
async function musterTap(raw) {
  const uid = normUid(raw); const ev = state.emer && state.emer.event; if (!uid || !ev) return;
  if (!state.emerPoint) return toast('Escolhe o ponto de encontro.');
  const x = { p_event: ev.id, p_point: state.emerPoint, p_uid: uid, p_client_id: uuid(), p_at: serverNow().toISOString() };
  let data = null; let error = null;
  if (!state.offline && navigator.onLine !== false) ({ data, error } = await sb.rpc('mini_muster_scan', x));
  if (state.offline || navigator.onLine === false || (error && /fetch|network|Failed/i.test(error.message || ''))) {
    store(MUSTER_Q, [...load(MUSTER_Q, []), x]); beep(true);
    return showResult('warn', 'GUARDADO', 'Sem rede: a picagem vai quando a rede voltar.');
  }
  if (error) { beep(false); return showResult('bad', 'Não ficou registado', friendly(error)); }
  beep(true);
  if (!data.known) showResult('warn', 'Cartão desconhecido', 'Ficou registado. Pergunta o nome à pessoa.');
  else showResult('ok', data.name, data.expected ? 'Está no ponto de encontro.' : 'Não estava na lista de quem estava dentro. Ficou registado.');
  loadEmergency();
}
async function startEmergency(site, drill) {
  const kinds = drill ? { drill: EMER_KIND.drill } : Object.fromEntries(Object.entries(EMER_KIND).filter(([k]) => k !== 'drill'));
  const fd = await askSheet(drill ? 'Começar simulacro' : 'Começar emergência', `
    ${drill ? '' : '<p class="small" style="color:var(--bad)"><b>Primeiro a segurança das pessoas. Liga 112 se for preciso.</b></p>'}
    <label>O quê? *</label><div class="chips reasons" role="radiogroup">${Object.entries(kinds).map(([k, v], i) => `<label class="chip"><input type="radio" name="k" value="${k}" ${i ? '' : 'checked'} required>${esc(v)}</label>`).join('')}</div>
    <label for="en">Nota</label><input id="en" name="n" maxlength="500" placeholder="ex.: alarme na unidade 3">
    <p class="small muted">Quem está na obra agora fica na lista. O encarregado, a segurança e o gestor são avisados.</p>`, drill ? 'Começar simulacro' : 'COMEÇAR');
  if (!fd) return;
  const { error } = await sb.rpc('mini_emergency_start', { p_site: site.id, p_kind: fd.get('k'), p_note: String(fd.get('n') || '').trim() || null });
  if (error) return toast(friendly(error));
  loadEmergency().then(() => { if ('NDEFReader' in window && !state.nfc) musterNfc(); });
}
async function addPoint(site) {
  const fd = await askSheet('Novo ponto de encontro', `<label for="pn">Nome *</label><input id="pn" name="n" required minlength="2" maxlength="120" placeholder="ex.: Portaria Norte">
    <p class="small muted">Uma obra pode ter vários pontos (fábricas grandes têm muitos). Ficam numerados PE1, PE2…</p>`, 'Acrescentar');
  if (!fd) return;
  const { data, error } = await sb.rpc('mini_assembly_point_add', { p_site: site.id, p_name: String(fd.get('n')).trim() });
  if (error) return toast(friendly(error));
  state.emerPoint = data; loadEmergency();
}
async function markSafe(id, name) {
  const pts = (state.emer && state.emer.points) || [];
  const fd = await askSheet(`${name} está salvo`, `<p class="small muted">Para quem não tem o cartão. Fica registado com o teu nome.</p>
    <label for="mp">Em que ponto?</label><select id="mp" name="p">${pts.map((p) => `<option value="${esc(p.id)}" ${p.id === state.emerPoint ? 'selected' : ''}>${esc(p.code)} · ${esc(p.name)}</option>`).join('')}</select>
    <label for="mn">Como sabes? *</label><input id="mn" name="n" required minlength="3" maxlength="200" placeholder="ex.: vi-o no ponto, sem cartão">`, 'Marcar salvo');
  if (!fd) return;
  const { error } = await sb.rpc('mini_muster_mark', { p_event: state.emer.event.id, p_point: fd.get('p'), p_collab: id, p_note: String(fd.get('n')).trim() });
  if (error) return toast(friendly(error));
  loadEmergency();
}
async function endEmergency(ev) {
  const missing = (ev.people || []).filter((p) => !p.safe).length;
  const fd = await askSheet(`Terminar ${ev.kind === 'drill' ? 'simulacro' : 'emergência'}`, `
    ${missing ? `<p class="small" style="color:var(--bad)"><b>Ainda há ${missing} pessoa(s) em falta.</b> Só termines se souberes onde estão.</p>` : ''}
    <label for="ee">Como acabou? *</label><textarea id="ee" name="n" required minlength="5" maxlength="500" placeholder="ex.: todos contados, alarme falso"></textarea>`, 'Terminar');
  if (!fd) return;
  const { error } = await sb.rpc('mini_emergency_end', { p_event: ev.id, p_note: String(fd.get('n')).trim() });
  if (error) return toast(friendly(error));
  stopNfc(); toast('Terminada. Fica no registo.'); loadEmergency();
}
// A red bar on every screen while an emergency is open at the chosen site, so nobody misses one someone else started.
async function checkEmergencyBar() {
  let bar = document.getElementById('emerbar');
  const site = currentSite();
  if (!state.ready || !canEmergency() || state.offline || !site || state.view === 'emergencia') { if (bar) bar.hidden = true; return; }
  const { data } = await sb.rpc('mini_emergency', { p_site: site.id });
  const ev = data && data.event;
  if (!bar) { bar = document.createElement('button'); bar.id = 'emerbar'; bar.type = 'button'; bar.onclick = () => go('emergencia'); document.querySelector('header.top').after(bar); }
  bar.hidden = !ev || state.view === 'emergencia';
  if (ev) { const miss = (ev.people || []).filter((p) => !p.safe).length;
    bar.className = ev.kind === 'drill' ? 'drill' : '';
    bar.innerHTML = `${ic('warn')}<b>${ev.kind === 'drill' ? 'SIMULACRO' : 'EMERGÊNCIA'} em ${esc(site.title)}</b><span>${miss} em falta · tocar para contar</span>`; }
}
setInterval(() => { if (document.visibilityState === 'visible') checkEmergencyBar(); }, 20000);

// ------------------------------------------------------------------ Armazém (sql/65): EPI, farda, consumíveis e ferramentas
// Entregar: a pessoa encosta o cartão (quem recebe), escolhes o que leva, e ela encosta outra vez para assinar.
// Stock por armazém e por tamanho, com mínimos. Ferramentas: quem tem o quê; inspeção vencida não deixa sair.
// Nunca se cobra EPI ao trabalhador; perdas e danos ficam com nota, sem desconto.
const canWh = () => ['armazem.ver', 'armazem.entregar', 'armazem.gerir'].some(can);
const WH_CAT = { ppe: 'EPI', workwear: 'Farda', consumable: 'Consumível', tool: 'Ferramenta' };
const WH_KIND = { top: 'camisola', bottom: 'calça', shoes: 'botas', gloves: 'luvas' };
const TOOL_ST = { available: ['ok', 'disponível'], checked_out: ['info', 'emprestada'], maintenance: ['warn', 'em reparação'],
  blocked: ['bad', 'bloqueada'], lost: ['bad', 'perdida'], retired: ['', 'abatida'] };
function viewWarehouse() {
  if (!canWh()) return viewClock();   // code guard as well as the database's
  if (!state.wh) state.wh = { tab: null, cart: [], tools: [], person: null, wid: null };
  app.innerHTML = `<div class="ph"><div><p class="ph-k">EPI, farda e ferramentas</p><h1>Armazém</h1></div></div>
    <div id="whtop">${skel(1)}</div><div id="whbody"></div>`;
  loadWarehouse();
}
async function loadWarehouse() {
  const top = $('#whtop'); if (!top) return;
  const { data: h, error } = await sb.rpc('mini_wh_home');
  if (!top.isConnected) return;
  if (error) { top.innerHTML = `<p>${esc(friendly(error))}</p>`; return; }
  const W = state.wh; W.home = h;
  if (!W.wid || !h.warehouses.find((w) => w.id === W.wid)) W.wid = h.central;
  if (!W.tab) W.tab = h.can_issue ? 'entregar' : 'stock';
  const tabs = [h.can_issue && ['entregar', 'Entregar'], ['stock', 'Stock'], ['ferramentas', 'Ferramentas']].filter(Boolean);
  top.innerHTML = `<div class="kpis k4 wh-kpis">
      <button class="kpi ${h.low ? 'warn' : ''}" data-tab="stock"><b>${h.low}</b><span>artigos no mínimo</span></button>
      <button class="kpi ${h.tools_late ? 'warn' : ''}" data-tab="ferramentas"><b>${h.tools_out}${h.tools_late ? `<small> · ${h.tools_late} atrasadas</small>` : ''}</b><span>ferramentas fora</span></button>
      <button class="kpi ${h.inspections_due ? 'warn' : ''}" data-tab="ferramentas"><b>${h.inspections_due}</b><span>inspeções a vencer</span></button>
      <div class="kpi ${h.ppe_due ? 'info' : ''}"><b>${h.ppe_due}</b><span>EPI a trocar em 30 dias</span></div></div>
    <div class="wh-bar">${h.warehouses.length > 1 ? `<select id="whsel" aria-label="Armazém">${h.warehouses.map((w) => `<option value="${esc(w.id)}" ${w.id === W.wid ? 'selected' : ''}>${esc(w.name)}${w.site ? ' (' + esc(w.site) + ')' : ''}</option>`).join('')}</select>` : `<span class="muted small">${esc(h.warehouses[0].name)}</span>`}
      ${h.can_manage ? '<button class="btn ghost small" id="whadd">+ Armazém</button>' : ''}</div>
    <div class="seg wh-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-whtab="${k}" aria-selected="${W.tab === k}">${l}</button>`).join('')}</div>`;
  top.querySelectorAll('[data-whtab]').forEach((b) => b.onclick = () => { W.tab = b.dataset.whtab; stopNfc(); loadWarehouse(); });
  top.querySelectorAll('button.kpi[data-tab]').forEach((b) => b.onclick = () => { W.tab = b.dataset.tab; stopNfc(); loadWarehouse(); });
  if ($('#whsel')) $('#whsel').onchange = (e) => { W.wid = e.target.value; W.cart = []; loadWarehouse(); };
  if ($('#whadd')) $('#whadd').onclick = addWarehouse;
  ({ entregar: whIssue, stock: whStock, ferramentas: whTools }[W.tab] || whStock)();
}
async function addWarehouse() {
  const sites = activeSites();
  const fd = await askSheet('Novo armazém', `<label for="wn">Nome *</label><input id="wn" name="n" required minlength="2" maxlength="120" placeholder="ex.: Carrinha 1, Contentor Sines">
    <label for="ws">Fica numa obra?</label><select id="ws" name="s"><option value="">Não (armazém da empresa)</option>${sites.map((s) => `<option value="${esc(s.id)}">${esc(s.title)} (${esc(s.cost_center_code)})</option>`).join('')}</select>`, 'Criar');
  if (!fd) return;
  const { data, error } = await sb.rpc('mini_wh_add', { p_name: String(fd.get('n')).trim(), p_site: fd.get('s') || null });
  if (error) return toast(friendly(error));
  state.wh.wid = data; toast('Armazém criado.'); loadWarehouse();
}

// ---- Entregar
async function whIssue() {
  const W = state.wh; const body = $('#whbody'); if (!body) return;
  const nfcOk = 'NDEFReader' in window;
  if (!W.person) {
    const people = (state.people || []).filter((p) => p.is_active !== false);
    body.innerHTML = `<section class="card wh-who"><h2 style="margin-top:0">Quem recebe?</h2>
      ${nfcOk ? `<button class="tapzone" id="nfc" aria-pressed="false"><span class="ring">${ic('tap')}</span><b id="nfclbl">Tocar para ligar o leitor</b>
        <span class="small" id="nfchelp">Depois a pessoa encosta o cartão.</span></button>` : ''}
      <label for="whp">Ou escolhe a pessoa</label><select id="whp"><option value="">—</option>${people.map((p) => `<option value="${esc(p.id)}">${esc(p.full_name)}${p.employee_number ? ' · ' + esc(p.employee_number) : ''}</option>`).join('')}</select>
      <div id="result" aria-live="polite"></div></section>`;
    $('#whp').onchange = (e) => e.target.value && whPick(e.target.value, null);
    if (nfcOk) $('#nfc').onclick = () => (state.nfc ? stopNfc() : whNfc((uid) => whPick(null, uid)));
    return;
  }
  const p = W.person; const [{ data: stock }, { data: tools }] = await Promise.all([sb.rpc('mini_wh_stock', { p_warehouse: W.wid }), sb.rpc('mini_wh_tools')]);
  if (!body.isConnected) return;
  W.stock = stock || []; W.toolList = tools || [];
  const fams = []; for (const it of W.stock) { let f = fams.find((x) => x.family === it.family); if (!f) fams.push(f = { family: it.family, category: it.category, kind: it.size_kind, items: [] }); f.items.push(it); }
  W.fams = fams;
  const sizeOf = (kind) => kind && p.sizes ? p.sizes[kind] : null;
  const ppe = p.ppe || []; const held = p.tools || [];
  body.innerHTML = `<section class="card wh-person"><div class="wk">${avatar(p.name)}<div class="grow"><div class="nm">${esc(p.name)}</div>
        <div class="sub">${esc([p.number, p.job].filter(Boolean).join(' · '))}</div></div><button class="btn ghost small" id="whchg">Trocar</button></div>
      <h3>Tamanhos da ficha</h3><div class="farda f4">${Object.entries(WH_KIND).map(([k, l]) => `<div class="${p.sizes[k] ? '' : 'none'}"><span>${esc(l[0].toUpperCase() + l.slice(1))}</span><b>${p.sizes[k] ? esc(p.sizes[k]) : '?'}</b></div>`).join('')}</div>
      ${Object.values(p.sizes).some((x) => !x) ? `<div class="wh-miss"><p class="small"><b>Faltam tamanhos na ficha.</b> Pergunta só desta vez: ficam guardados para as próximas entregas.</p>
        <button class="btn small" id="whsz" type="button">Preencher tamanhos</button></div>` : `<p class="small muted">Vêm da ficha do trabalhador. <button class="btn ghost small" id="whsz" type="button">Corrigir</button></p>`}
      ${ppe.length || held.length ? `<h3>Tem agora</h3><ul class="wh-has">${ppe.map((a) => `<li>${esc(a.name)} <span class="muted">· desde ${esc(fmtDate(a.issued.slice(0, 10)))}</span>
          ${a.replace_after ? (a.late ? chip('bad', 'trocar já') : a.due ? chip('warn', 'trocar a ' + fmtDate(a.replace_after)) : `<span class="small muted">troca ${esc(fmtDate(a.replace_after))}</span>`) : ''}</li>`).join('')}
        ${held.map((t) => `<li>${ic('key')} ${esc(t.name)} <b>${esc(t.tag)}</b> ${t.late ? chip('bad', 'atrasada') : `<span class="small muted">até ${esc(fmtTime(t.due))}</span>`}
          <button class="btn ghost small" data-ret="${esc(t.tool)}" data-tag="${esc(t.tag)}">Devolver</button></li>`).join('')}</ul>` : '<p class="small muted">Não tem nada entregue.</p>'}
      ${(p.allowance || []).length ? `<p class="small">${p.allowance.map((x) => `${esc(x.family)}: <b>${Number(x.taken)}</b> de ${x.per_year} este ano`).join(' · ')}</p>` : ''}
      <button class="btn ghost small" id="whrec">${ic('doc')}Ficha de EPI</button></section>
    <section class="card"><h2 style="margin-top:0">O que leva</h2>
      ${fams.length ? `<div class="wh-fams">${fams.map((f, i) => { const mine = sizeOf(f.kind); const own = mine ? f.items.find((x) => x.size && x.size === String(mine).toUpperCase()) : null;
        const pick = (own && own.qty > 0 ? own : null) || f.items.find((x) => x.qty > 0) || f.items[0];
        const note = !f.kind ? '' : !mine ? chip('warn', 'tamanho em falta na ficha') : !own || own.qty <= 0 ? chip('bad', `sem stock no ${mine}`) : chip('ok', `ficha: ${mine}`);
        return `<div class="wh-fam" data-i="${i}"><div class="grow"><b>${esc(f.family)}</b><small>${esc(WH_CAT[f.category] || f.category)}</small>${note}</div>
          ${f.items.length > 1 || f.items[0].size ? `<select data-size aria-label="Tamanho">${f.items.map((x) => `<option value="${esc(x.id)}" ${x.id === pick.id ? 'selected' : ''} ${x.qty > 0 ? '' : 'disabled'}>${esc(x.size || '—')} ${own && x.id === own.id ? ' ★' : ''} (${Number(x.qty)})</option>`).join('')}</select>` : `<span class="small muted">${Number(f.items[0].qty)} ${esc(f.items[0].unit)}</span>`}
          <button class="btn small" data-add>+</button></div>`; }).join('')}</div>`
        : `<p class="small muted">Este armazém ainda não tem artigos com stock.${W.home.can_manage ? ' Cria-os em «Stock».' : ''}</p>`}
      ${W.toolList.filter((t) => t.status === 'available').length ? `<label for="wht">Ferramenta</label><div class="wh-addrow"><select id="wht"><option value="">—</option>${W.toolList.filter((t) => t.status === 'available').map((t) => `<option value="${esc(t.id)}" ${t.expired ? 'disabled' : ''}>${esc(t.tag)} · ${esc(t.name)}${t.expired ? ' (inspeção vencida)' : ''}</option>`).join('')}</select><button class="btn small" id="whtadd" type="button">+</button></div>` : ''}
      <div id="whcart"></div></section>`;
  $('#whchg').onclick = () => { W.person = null; W.cart = []; W.tools = []; whIssue(); };
  $('#whrec').onclick = () => { state.recordFor = p.id; state.recordBack = 'armazem'; go('fichaepi'); };
  $('#whsz').onclick = () => whSizes(p);
  body.querySelectorAll('[data-ret]').forEach((b) => b.onclick = () => returnTool(b.dataset.ret, b.dataset.tag, () => whPick(p.id, null)));
  body.querySelectorAll('.wh-fam').forEach((row) => row.querySelector('[data-add]').onclick = () => {
    const f = fams[+row.dataset.i]; const id = row.querySelector('[data-size]') ? row.querySelector('[data-size]').value : f.items[0].id;
    const it = f.items.find((x) => x.id === id); const c = W.cart.find((x) => x.item === id);
    if ((c ? c.qty : 0) + 1 > Number(it.qty)) return toast(`Só há ${Number(it.qty)} em stock.`);
    if (c) c.qty++; else W.cart.push({ item: id, qty: 1, name: it.name, unit: it.unit });
    renderCart();
  });
  if ($('#whtadd')) $('#whtadd').onclick = () => { const v = $('#wht').value; if (!v || W.tools.includes(v)) return; W.tools.push(v); renderCart(); };
  renderCart();
}
// Sizes live in the worker's card. The storekeeper only fills what is missing (or fixes it); it is saved in the card.
const GLOVES = ['6', '7', '8', '9', '10', '11', '12'];
async function whSizes(p) {
  const lists = { top: SIZES_TOP, bottom: SIZES_BOTTOM, shoes: SIZES_SHOES, gloves: GLOVES };
  const fd = await askSheet(`Tamanhos de ${p.name}`, `<p class="small muted">Ficam na ficha do trabalhador. Na próxima entrega já não é preciso perguntar.</p>
    <div class="row">${Object.entries(WH_KIND).map(([k, l]) => `<div><label for="sz${k}">${esc(l[0].toUpperCase() + l.slice(1))}</label><select id="sz${k}" name="${k}">
      <option value="">${p.sizes[k] ? '' : '?'}</option>${lists[k].map((x) => `<option ${x === p.sizes[k] ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>`).join('')}</div>`, 'Guardar na ficha');
  if (!fd) return;
  const body = Object.fromEntries(Object.keys(WH_KIND).map((k) => [k, fd.get(k) || '']));
  const { data, error } = await sb.rpc('mini_wh_sizes_save', { p_collab: p.id, p_sizes: body });
  if (error) return toast(friendly(error));
  p.sizes = data; toast('Tamanhos guardados na ficha.'); whIssue();
}
function renderCart() {
  const W = state.wh; const el = $('#whcart'); if (!el) return;
  const n = W.cart.length + W.tools.length;
  if (!n) { el.innerHTML = ''; return; }
  const sites = activeSites(); const cur = currentSite();
  el.innerHTML = `<h3>A entregar</h3><ul class="wh-cart">${W.cart.map((c, i) => `<li><span class="grow">${esc(c.name)}</span>
      <span class="step"><button type="button" class="btn ghost small" data-dec="${i}" aria-label="Menos">−</button><b>${c.qty}</b><button type="button" class="btn ghost small" data-inc="${i}" aria-label="Mais">+</button></span></li>`).join('')}
    ${W.tools.map((id, i) => { const t = W.toolList.find((x) => x.id === id) || {}; return `<li><span class="grow">${ic('key')} ${esc(t.tag)} · ${esc(t.name)}</span><button type="button" class="btn ghost small" data-rmt="${i}" aria-label="Tirar">×</button></li>`; }).join('')}</ul>
    <div class="row"><div><label for="whsite">Para a obra</label><select id="whsite"><option value="">Sem obra</option>${sites.map((s) => `<option value="${esc(s.id)}" ${cur && cur.id === s.id ? 'selected' : ''}>${esc(s.title)} (${esc(s.cost_center_code)})</option>`).join('')}</select></div>
      ${W.tools.length ? `<div><label for="whdue">Devolve até</label><input id="whdue" type="date" value="${esc(isoDay(new Date()))}" min="${esc(isoDay(new Date()))}"></div>` : ''}</div>
    <div id="whwhy"${W.needWhy ? '' : ' hidden'}><label for="whr">Porquê? *</label><input id="whr" maxlength="300" placeholder="ex.: botas rasgadas, perdeu as luvas">
      <p class="small muted">${esc(W.needWhy || '')}</p></div>
    <button class="btn big" id="whsign">${ic('card')}Assinar com o cartão de ${esc(W.person.name.split(' ')[0])}</button>`;
  el.querySelectorAll('[data-inc]').forEach((b) => b.onclick = () => { const c = W.cart[+b.dataset.inc]; const it = W.stock.find((x) => x.id === c.item);
    if (c.qty + 1 > Number(it.qty)) return toast(`Só há ${Number(it.qty)} em stock.`); c.qty++; renderCart(); });
  el.querySelectorAll('[data-dec]').forEach((b) => b.onclick = () => { const i = +b.dataset.dec; if (--W.cart[i].qty <= 0) W.cart.splice(i, 1); renderCart(); });
  el.querySelectorAll('[data-rmt]').forEach((b) => b.onclick = () => { W.tools.splice(+b.dataset.rmt, 1); renderCart(); });
  $('#whsign').onclick = whSign;
}
async function whPick(id, uid) {
  stopNfc();
  const { data, error } = await sb.rpc('mini_wh_person', { p_collab: id, p_uid: uid ? normUid(uid) : null });
  if (error) { beep(false); return showResult('bad', 'Não encontrei', friendly(error)); }
  if (uid) beep(true);
  Object.assign(state.wh, { person: data, cart: state.wh.person && state.wh.person.id === data.id ? state.wh.cart : [], tools: state.wh.person && state.wh.person.id === data.id ? state.wh.tools : [], needWhy: null });
  whIssue();
}
// The person signs: their own card, on this phone. The same tap number is sent again if the network failed (no double delivery).
function whSign() {
  const W = state.wh; const p = W.person; const nfcOk = 'NDEFReader' in window;
  const why = $('#whr') ? $('#whr').value.trim() : '';
  const dueDay = $('#whdue') ? $('#whdue').value : null;
  const req = { p_warehouse: W.wid, p_collab: p.id, p_lines: W.cart.map((c) => ({ item: c.item, qty: c.qty })), p_tools: W.tools.length ? W.tools : null,
    p_project: ($('#whsite') && $('#whsite').value) || null, p_due: dueDay ? zonedToUtc(`${dueDay}T20:00`, DEFAULT_TZ) : null, p_reason: why || null, p_client_id: W.batch || (W.batch = uuid()) };
  const d = document.createElement('dialog'); d.className = 'dlg';
  d.innerHTML = `<form method="dialog"><h2>${esc(p.name)} assina</h2><p class="small muted">Recebe: ${esc([...W.cart.map((c) => `${c.qty} × ${c.name}`), ...W.tools.map((id) => (W.toolList.find((t) => t.id === id) || {}).tag)].join(', '))}.</p>
    ${nfcOk ? `<button class="tapzone reading" type="button"><span class="ring">${ic('tap')}</span><b>${esc(p.name.split(' ')[0])}, encoste o seu cartão</b></button>` : ''}
    <div class="manual"><input id="suid" autocomplete="off" autocapitalize="characters" placeholder="Número do cartão"><button class="btn ghost" type="button" id="sgo">Assinar</button></div>
    <div id="sres" aria-live="polite"></div><div class="acts"><button class="btn ghost wide" value="cancel">Cancelar</button></div></form>`;
  document.body.appendChild(d); d.showModal();
  let ctrl = null; let busy = false;
  const go2 = async (raw) => {
    const uid = normUid(raw); if (!uid || busy) return; busy = true;
    const { data, error } = await sb.rpc('mini_wh_issue', { ...req, p_uid: uid });
    busy = false;
    if (error) {
      beep(false); const m = /needs a reason/i.test(error.message || '');
      if (m) { W.needWhy = 'Troca antes do tempo ou acima da dotação: escreve o motivo, fica na ficha.'; d.close(); renderCart(); $('#whr').focus(); return toast('Escreve o motivo e assina outra vez.'); }
      d.querySelector('#sres').innerHTML = `<div class="result bad">${ic('x')}<div><b>Não assinou</b>${esc(friendly(error))}</div></div>`; return;
    }
    beep(true); d.close();
    showFlash('ok', 'ENTREGUE', `${p.name} assinou ${data.replayed ? '(já estava registado)' : ''}.`);
    Object.assign(W, { cart: [], tools: [], batch: null, needWhy: null }); whPick(p.id, null);
  };
  if (nfcOk) (async () => { try { ctrl = new AbortController(); const r = new NDEFReader(); await r.scan({ signal: ctrl.signal }); r.onreading = (ev) => go2(ev.serialNumber); } catch (_) { /* typed number still works */ } })();
  d.querySelector('#sgo').onclick = () => go2(d.querySelector('#suid').value);
  d.querySelector('#suid').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go2(e.target.value); } };
  d.addEventListener('close', () => { if (ctrl) ctrl.abort(); d.remove(); });
}
async function whNfc(onUid) {
  try {
    const ctrl = new AbortController(); const reader = new NDEFReader();
    await reader.scan({ signal: ctrl.signal }); state.nfc = ctrl; nfcLook(true);
    $('#nfchelp').textContent = 'A pessoa encosta o cartão.';
    reader.onreading = (ev) => { const uid = normUid(ev.serialNumber); if (uid) onUid(uid); };
    reader.onreadingerror = () => { beep(false); showResult('bad', 'NÃO LIDO', 'Encosta outra vez, devagar.'); };
  } catch (err) { toast(err.name === 'NotAllowedError' ? 'Dá permissão ao NFC no Chrome.' : 'O NFC não arrancou: ' + err.message); }
}
async function returnTool(id, tag, after) {
  const fd = await askSheet(`Devolver ${tag}`, `<label>Como veio? *</label><div class="chips reasons" role="radiogroup">
      <label class="chip"><input type="radio" name="c" value="ok" checked required>Em bom estado</label>
      <label class="chip"><input type="radio" name="c" value="damaged">Danificada</label><label class="chip"><input type="radio" name="c" value="lost">Perdida</label></div>
    <label for="rn">Nota</label><input id="rn" name="n" maxlength="300" placeholder="Obrigatória se danificada ou perdida">
    <p class="small muted">Fica registado. Nada é descontado ao trabalhador por aqui.</p>`, 'Registar');
  if (!fd) return;
  const { data, error } = await sb.rpc('mini_wh_return', { p_tool: id, p_condition: fd.get('c'), p_note: String(fd.get('n') || '').trim() || null, p_warehouse: state.wh && state.wh.wid });
  if (error) return toast(friendly(error));
  toast(`${data.tag} devolvida por ${data.from}.`); after ? after() : loadWarehouse();
}

// ---- Stock
async function whStock() {
  const W = state.wh; const body = $('#whbody'); if (!body) return;
  body.innerHTML = skel(3);
  const { data, error } = await sb.rpc('mini_wh_stock', { p_warehouse: W.wid });
  if (!body.isConnected) return;
  if (error) { body.innerHTML = `<p>${esc(friendly(error))}</p>`; return; }
  W.stock = data; const m = W.home.can_manage;
  const fams = []; for (const it of data) { let f = fams.find((x) => x.family === it.family); if (!f) fams.push(f = { family: it.family, category: it.category, items: [] }); f.items.push(it); }
  body.innerHTML = `${m ? '<div class="acts-row"><button class="btn" id="whnew">+ Artigo</button></div>' : ''}
    ${fams.length ? `<div class="list">${fams.map((f, i) => { const low = f.items.some((x) => x.low); const tot = f.items.reduce((s, x) => s + Number(x.qty), 0);
      return `<article class="card wh-row ${low ? 'low' : ''}"><div class="wk"><div class="grow"><div class="nm">${esc(f.family)}</div>
          <div class="sub">${esc(WH_CAT[f.category] || f.category)} · ${tot} ${esc(f.items[0].unit)}${f.items[0].life_days ? ` · troca a cada ${f.items[0].life_days} dias` : ''}${f.items[0].allowance ? ` · ${f.items[0].allowance} por ano` : ''}</div></div>
          ${low ? chip('warn', 'no mínimo', 'warn') : ''}</div>
        <div class="wh-sizes">${f.items.map((x) => `<span class="wh-sz ${x.low ? 'low' : Number(x.qty) ? '' : 'zero'}" title="mínimo ${Number(x.min)}"><b>${esc(x.size || 'un')}</b>${Number(x.qty)}</span>`).join('')}</div>
        ${m ? `<div class="acts"><button class="btn ghost small" data-in="${i}">Entrada</button><button class="btn ghost small" data-min="${i}">Mínimo</button><button class="btn ghost small" data-edit="${i}">Editar</button></div>` : ''}</article>`; }).join('')}</div>`
      : `<div class="card">${empty('box', 'Ainda sem artigos', m ? 'Carrega em «+ Artigo»: botas, capacetes, luvas, farda.' : 'Quem gere o armazém cria os artigos.')}</div>`}`;
  if ($('#whnew')) $('#whnew').onclick = () => itemSheet(null);
  body.querySelectorAll('[data-in]').forEach((b) => b.onclick = () => stockIn(fams[+b.dataset.in]));
  body.querySelectorAll('[data-min]').forEach((b) => b.onclick = () => setMin(fams[+b.dataset.min]));
  body.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => itemSheet(fams[+b.dataset.edit]));
}
async function itemSheet(f) {
  const it = f && f.items[0];
  const fd = await askSheet(f ? `Editar ${f.family}` : 'Novo artigo', `
    <label>Tipo *</label><div class="chips reasons" role="radiogroup">${['ppe', 'workwear', 'consumable'].map((k, i) => `<label class="chip"><input type="radio" name="cat" value="${k}" ${(it ? it.category === k : !i) ? 'checked' : ''} required>${WH_CAT[k]}</label>`).join('')}</div>
    <label for="in">Nome *</label><input id="in" name="name" required minlength="2" maxlength="120" value="${esc(f ? f.family : '')}" placeholder="ex.: Botas S3, Capacete, Calças de trabalho">
    ${f ? `<label for="ia">Acrescentar um tamanho</label><input id="ia" name="add" maxlength="8" placeholder="ex.: 45">`
      : `<label for="is">Tamanhos</label><input id="is" name="sizes" maxlength="200" placeholder="ex.: 38, 39, 40, 41, 42 ou S, M, L, XL (vazio se não tem)">`}
    <div class="row"><div><label for="ik">Tamanho da ficha</label><select id="ik" name="kind"><option value="">—</option>${Object.entries(WH_KIND).map(([k, l]) => `<option value="${k}" ${it && it.size_kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><label for="iu">Unidade</label><input id="iu" name="unit" maxlength="16" value="${esc(it ? it.unit : 'un')}"></div></div>
    <div class="row"><div><label for="ic">Preço (€)</label><input id="ic" name="cost" type="number" min="0" max="100000" step="0.01" inputmode="decimal" value="${it ? Number(it.unit_cost) : ''}"></div>
      <div><label for="il">Trocar a cada (dias)</label><input id="il" name="life" type="number" min="1" max="3650" inputmode="numeric" value="${it && it.life_days ? it.life_days : ''}" placeholder="ex.: 365"></div>
      <div><label for="iy">Dotação por ano</label><input id="iy" name="allow" type="number" min="1" max="50" inputmode="numeric" value="${it && it.allowance ? it.allowance : ''}" placeholder="ex.: 2"></div></div>
    <p class="small muted">«Tamanho da ficha» escolhe sozinho o tamanho da pessoa na entrega. A dotação por ano é para a farda: acima dela pede-se o motivo.</p>`, f ? 'Guardar' : 'Criar');
  if (!fd) return;
  const data = { category: fd.get('cat'), family: String(fd.get('name')).trim(), size_kind: fd.get('kind') || null, unit: String(fd.get('unit') || 'un').trim(),
    unit_cost: fd.get('cost') || null, life_days: fd.get('life') || null, allowance: fd.get('allow') || null };
  if (f) data.add_size = String(fd.get('add') || '').trim() || null;
  else data.sizes = String(fd.get('sizes') || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const { error } = await sb.rpc('mini_wh_item_save', { p_item: it ? it.id : null, p_data: data });
  if (error) return toast(friendly(error));
  toast(f ? 'Guardado.' : 'Artigo criado. Agora dá entrada do stock.'); loadWarehouse();
}
const sizeOpts = (f) => f.items.map((x) => `<option value="${esc(x.id)}">${esc(x.size || f.family)} (tem ${Number(x.qty)})</option>`).join('');
async function stockIn(f) {
  const fd = await askSheet(`Entrada: ${f.family}`, `${f.items.length > 1 ? `<label for="sz">Tamanho</label><select id="sz" name="i">${sizeOpts(f)}</select>` : `<input type="hidden" name="i" value="${esc(f.items[0].id)}">`}
    <div class="row"><div><label for="sq">Quantidade *</label><input id="sq" name="q" type="number" min="1" max="100000" step="1" inputmode="numeric" required autofocus></div>
      <div><label for="sc">Preço (€/un)</label><input id="sc" name="c" type="number" min="0" max="100000" step="0.01" inputmode="decimal" placeholder="${esc(Number(f.items[0].unit_cost).toFixed(2))}"></div></div>
    <label for="sn">Nota</label><input id="sn" name="n" maxlength="200" placeholder="ex.: fatura 123 do fornecedor">`, 'Dar entrada');
  if (!fd) return;
  const { error } = await sb.rpc('mini_wh_stock_in', { p_warehouse: state.wh.wid, p_item: fd.get('i'), p_qty: Number(fd.get('q')), p_unit_cost: fd.get('c') ? Number(fd.get('c')) : null, p_note: String(fd.get('n') || '').trim() || null });
  if (error) return toast(friendly(error));
  toast('Entrada registada.'); loadWarehouse();
}
async function setMin(f) {
  const fd = await askSheet(`Mínimo: ${f.family}`, `${f.items.length > 1 ? `<label for="mz">Tamanho</label><select id="mz" name="i">${f.items.map((x) => `<option value="${esc(x.id)}">${esc(x.size || f.family)} (mínimo ${Number(x.min)})</option>`).join('')}</select>` : `<input type="hidden" name="i" value="${esc(f.items[0].id)}">`}
    <label for="mq">Avisa quando houver só</label><input id="mq" name="q" type="number" min="0" max="100000" step="1" inputmode="numeric" required autofocus>
    <p class="small muted">Ao chegar ao mínimo, o armazém avisa e fica um pedido de reposição para as compras.</p>`, 'Guardar');
  if (!fd) return;
  const { error } = await sb.rpc('mini_wh_set_min', { p_warehouse: state.wh.wid, p_item: fd.get('i'), p_min: Number(fd.get('q')) });
  if (error) return toast(friendly(error));
  toast('Mínimo guardado.'); loadWarehouse();
}

// ---- Ferramentas
async function whTools() {
  const W = state.wh; const body = $('#whbody'); if (!body) return;
  body.innerHTML = skel(3);
  const { data, error } = await sb.rpc('mini_wh_tools');
  if (!body.isConnected) return;
  if (error) { body.innerHTML = `<p>${esc(friendly(error))}</p>`; return; }
  const m = W.home.can_manage; const give = W.home.can_issue;
  body.innerHTML = `${m ? '<div class="acts-row"><button class="btn" id="whtnew">+ Ferramenta</button></div>' : ''}
    ${data.length ? `<div class="list">${data.map((t) => { const [k, l] = TOOL_ST[t.status] || ['', t.status]; const h = t.holder;
      return `<article class="card wh-tool ${h && h.late ? 'late' : ''}"><div class="wk"><span class="wh-tag">${esc(t.tag)}</span><div class="grow"><div class="nm">${esc(t.name)}</div>
          <div class="sub">${h ? `${esc(h.name)}${h.site ? ' · ' + esc(h.site) : ''} · ${h.late ? '<b style="color:var(--bad)">devia ter voltado ' + esc(fmtTime(h.due)) + '</b>' : 'até ' + esc(fmtTime(h.due))}` : esc(t.warehouse || '')}</div></div>
          ${h && h.late ? chip('bad', 'atrasada') : chip(k, l)}</div>
        ${t.inspect ? `<p class="small" style="margin:8px 0 0">${t.expired ? chip('bad', 'inspeção vencida') : t.soon ? chip('warn', 'inspeção a vencer') : ''} Inspeção válida até <b>${t.valid_until ? esc(fmtDate(t.valid_until)) : '—'}</b>${t.ref ? ' · relatório ' + esc(t.ref) : ''}</p>` : ''}
        ${t.last_note && ['maintenance', 'lost', 'blocked'].includes(t.status) ? `<p class="small muted" style="margin:6px 0 0">«${esc(t.last_note)}»</p>` : ''}
        <div class="acts">${h && give ? `<button class="btn ghost small" data-ret="${esc(t.id)}" data-tag="${esc(t.tag)}">Devolver</button>` : ''}
          ${m && !h && !['lost', 'retired'].includes(t.status) ? `<button class="btn ghost small" data-insp="${esc(t.id)}" data-tag="${esc(t.tag)}">Inspeção</button>` : ''}
          ${m && t.status === 'maintenance' ? `<button class="btn ghost small" data-fix="${esc(t.id)}">Reparada</button>` : ''}
          ${m && !h && !['lost', 'retired'].includes(t.status) ? `<button class="btn ghost small" data-off="${esc(t.id)}" data-tag="${esc(t.tag)}">Abater</button>` : ''}</div></article>`; }).join('')}</div>`
      : `<div class="card">${empty('box', 'Ainda sem ferramentas', m ? 'Carrega em «+ Ferramenta» e dá-lhe um número (ex.: F-001), o mesmo da etiqueta.' : 'Quem gere o armazém regista as ferramentas.')}</div>`}`;
  if ($('#whtnew')) $('#whtnew').onclick = addTool;
  body.querySelectorAll('[data-ret]').forEach((b) => b.onclick = () => returnTool(b.dataset.ret, b.dataset.tag));
  body.querySelectorAll('[data-insp]').forEach((b) => b.onclick = () => inspectTool(b.dataset.insp, b.dataset.tag));
  body.querySelectorAll('[data-fix]').forEach((b) => b.onclick = async () => { const { error: e } = await sb.rpc('mini_wh_tool_status', { p_tool: b.dataset.fix, p_status: 'available', p_reason: null }); if (e) return toast(friendly(e)); toast('Disponível outra vez.'); loadWarehouse(); });
  body.querySelectorAll('[data-off]').forEach((b) => b.onclick = async () => {
    const fd = await askSheet(`Abater ${b.dataset.tag}`, `<label>Porquê? *</label><div class="chips reasons" role="radiogroup">${[['damaged', 'Avariada sem arranjo'], ['worn_out', 'Gasta'], ['obsolete', 'Já não serve'], ['stolen', 'Roubada']].map(([v, l], i) => `<label class="chip"><input type="radio" name="r" value="${v}" ${i ? '' : 'checked'} required>${l}</label>`).join('')}</div>`, 'Abater');
    if (!fd) return; const { error: e } = await sb.rpc('mini_wh_tool_status', { p_tool: b.dataset.off, p_status: 'retired', p_reason: fd.get('r') }); if (e) return toast(friendly(e)); toast('Abatida.'); loadWarehouse(); });
}
async function addTool() {
  const fd = await askSheet('Nova ferramenta', `<label for="tn">O que é *</label><input id="tn" name="n" required minlength="2" maxlength="120" placeholder="ex.: Rebarbadora 125, Detetor de gás">
    <div class="row"><div><label for="tt">Número (etiqueta) *</label><input id="tt" name="t" required maxlength="64" autocapitalize="characters" placeholder="ex.: F-001"></div>
      <div><label for="ts">Nº de série</label><input id="ts" name="s" maxlength="128"></div></div>
    <label class="check inline"><input type="checkbox" name="i" id="ti"> Precisa de inspeção ou calibração</label>
    <div class="row"><div><label for="tv">Válida até</label><input id="tv" name="v" type="date"></div><div><label for="tc">Preço (€)</label><input id="tc" name="c" type="number" min="0" step="0.01" inputmode="decimal"></div></div>
    <p class="small muted">Com inspeção vencida, a ferramenta não sai do armazém.</p>`, 'Criar');
  if (!fd) return;
  const { error } = await sb.rpc('mini_wh_tool_add', { p_name: String(fd.get('n')).trim(), p_tag: String(fd.get('t')).trim(), p_serial: String(fd.get('s') || '').trim() || null,
    p_warehouse: state.wh.wid, p_inspect: !!fd.get('i'), p_valid_until: fd.get('v') || null, p_cost: fd.get('c') ? Number(fd.get('c')) : null });
  if (error) return toast(friendly(error));
  toast('Ferramenta criada.'); loadWarehouse();
}
async function inspectTool(id, tag) {
  const today = isoDay(new Date());
  const fd = await askSheet(`Inspeção de ${tag}`, `<div class="row"><div><label for="ko">Feita a *</label><input id="ko" name="o" type="date" required value="${today}" max="${today}"></div>
      <div><label for="kv">Válida até *</label><input id="kv" name="v" type="date" required min="${today}"></div></div>
    <label>Resultado *</label><div class="chips reasons" role="radiogroup"><label class="chip"><input type="radio" name="r" value="1" checked required>Aprovada</label><label class="chip"><input type="radio" name="r" value="0">Reprovada</label></div>
    <div class="row"><div><label for="kr">Nº do relatório *</label><input id="kr" name="ref" required minlength="2" maxlength="64"></div><div><label for="kb">Quem fez</label><input id="kb" name="by" maxlength="120" placeholder="ex.: laboratório, técnico"></div></div>
    <p class="small muted">Reprovada fica bloqueada até nova inspeção aprovada.</p>`, 'Registar');
  if (!fd) return;
  const { error } = await sb.rpc('mini_wh_tool_inspect', { p_tool: id, p_on: fd.get('o'), p_valid_until: fd.get('v'), p_pass: fd.get('r') === '1', p_ref: String(fd.get('ref')).trim(), p_by: String(fd.get('by') || '').trim() || null });
  if (error) return toast(friendly(error));
  toast('Inspeção registada.'); loadWarehouse();
}

// ---- Ficha de entrega de EPI (to print and keep; each line says which card signed it and when)
async function viewPpeRecord() {
  if (!canWh() || !state.recordFor) return go('armazem');
  app.innerHTML = `<div class="noprint toolbar"><button class="btn ghost small" id="rback">← Voltar</button><button class="btn small" id="rprint">${ic('print')}Imprimir</button></div><div id="rbody">${skel(2)}</div>`;
  $('#rback').onclick = () => go(state.recordBack || 'armazem');
  $('#rprint').onclick = () => window.print();
  const { data: r, error } = await sb.rpc('mini_wh_record', { p_collab: state.recordFor });
  const el = $('#rbody'); if (!el) return;
  if (error) { el.innerHTML = `<p>${esc(friendly(error))}</p>`; return; }
  el.innerHTML = `<article class="card ppe-rec"><p class="ph-k">${esc(r.company)}</p><h1>Ficha de entrega de EPI e farda</h1>
    <p><b>${esc(r.name)}</b>${r.number ? ' · nº ' + esc(r.number) : ''}${r.job ? ' · ' + esc(r.job) : ''}</p>
    <p class="small muted">Cada entrega foi confirmada pelo trabalhador com o seu cartão pessoal, na hora indicada. Os EPI são fornecidos pela empresa sem custo para o trabalhador.</p>
    ${r.lines.length ? `<table class="tbl"><thead><tr><th>Data</th><th>Artigo</th><th>Qtd.</th><th>Trocar a</th><th>Obra</th><th>Cartão</th><th>Entregue por</th></tr></thead><tbody>
      ${r.lines.map((l) => `<tr><td>${esc(fmtTime(l.at))}</td><td>${esc(l.item)}${l.note ? `<br><small class="muted">${esc(l.note)}</small>` : ''}</td><td>${Number(l.qty)} ${esc(l.unit)}</td>
        <td>${l.replace_after ? esc(fmtDate(l.replace_after)) : '—'}</td><td>${esc(l.site || '—')}</td><td>…${esc(l.card || '')}</td><td>${esc(l.by || '')}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Sem entregas registadas.</p>'}
    ${r.tools.length ? `<h2>Ferramentas</h2><table class="tbl"><thead><tr><th>Ferramenta</th><th>Saiu</th><th>Voltou</th><th>Estado</th></tr></thead><tbody>
      ${r.tools.map((t) => `<tr><td>${esc(t.tag)} · ${esc(t.name)}</td><td>${esc(fmtTime(t.out))}</td><td>${t.back ? esc(fmtTime(t.back)) : '<b>com a pessoa</b>'}</td>
        <td>${t.condition ? ({ ok: 'bom estado', damaged: 'danificada', lost: 'perdida' }[t.condition]) : ''}${t.note ? ' · ' + esc(t.note) : ''}</td></tr>`).join('')}</tbody></table>` : ''}
    <div class="print-only sign-lines"><p>Assinatura do trabalhador: ______________________________</p><p>Data: ____/____/______</p></div></article>`;
}
// The worker card: what this person has, with a link to the record.
async function loadWorkerKit(id) {
  const box = $('#fwh'); if (!box) return;
  const { data: p, error } = await sb.rpc('mini_wh_person', { p_collab: id, p_uid: null });
  if (!box.isConnected) return;
  if (error) { box.remove(); return; }
  box.innerHTML = `<h3>EPI, farda e ferramentas</h3>${(p.ppe || []).length || (p.tools || []).length ? `<ul class="wh-has">${p.ppe.map((a) => `<li>${esc(a.name)} <span class="muted">· ${esc(fmtDate(a.issued.slice(0, 10)))}</span> ${a.late ? chip('bad', 'trocar já') : a.due ? chip('warn', 'trocar a ' + fmtDate(a.replace_after)) : ''}</li>`).join('')}
      ${p.tools.map((t) => `<li>${ic('key')} ${esc(t.name)} <b>${esc(t.tag)}</b> ${t.late ? chip('bad', 'atrasada') : ''}</li>`).join('')}</ul>` : '<p class="small muted">Nada entregue.</p>'}
    <button class="btn ghost small" id="fwhrec">${ic('doc')}Ficha de EPI</button>`;
  $('#fwhrec').onclick = () => { state.recordFor = id; state.recordBack = 'ficha'; go('fichaepi'); };
}
