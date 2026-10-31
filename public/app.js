const defaultCrmStages = [
  { key: "new", label: "Novo", color: "#64748b" },
  { key: "contacted", label: "Contatado", color: "#2563eb" },
  { key: "qualified", label: "Qualificado", color: "#0e7490" },
  { key: "negotiating", label: "Negociação", color: "#d97706" },
  { key: "won", label: "Fechado", color: "#15803d" },
];

const icons = {
  users: '<svg class="icon" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  search: '<svg class="icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  columns: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="10" rx="1"/></svg>',
  message: '<svg class="icon" viewBox="0 0 24 24"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 9h8M8 13h5"/></svg>',
  settings: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.96 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3.04 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.96a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.04V3h4v.08a1.7 1.7 0 0 0 1.04 1.52 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.13.37.5.95 1.56 1H21v4h-.08a1.7 1.7 0 0 0-1.52 1Z"/></svg>',
  menu: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  plus: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg class="icon" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  arrow: '<svg class="icon" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  share: '<svg class="icon" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></svg>',
  download: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14"/></svg>',
  publish: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',
  video: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 10 4-2v8l-4-2z"/></svg>',
  check: '<svg class="icon" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
};

const state = {
  view: "leads",
  dashboard: { leads: [], stats: { stages: {} }, searches: [], settings: {} },
  filters: { search: "", stage: "", minScore: 0 },
  activeLeadId: null,
  polling: null,
  pendingWhatsappUrl: "",
  whatsappObserver: null,
  whatsappStatus: { status: "loading", message: "Conectando ao WhatsApp Web…" },
  social: { configs: [], accounts: [], posts: [], callbackUrls: {} },
  socialVideo: null,
  socialCover: null,
  socialBusy: "",
};

const app = document.querySelector("#app");
const drawer = document.querySelector("#detailDrawer");
const scrim = document.querySelector("#drawerScrim");
const toastEl = document.querySelector("#toast");
const sidebar = document.querySelector("#sidebar");

document.querySelectorAll("[data-icon]").forEach((element) => { element.innerHTML = icons[element.dataset.icon] || ""; });
document.addEventListener("click", handleClick);
document.querySelector("#menuButton").addEventListener("click", () => {
  const opening = !sidebar.classList.contains("is-open");
  sidebar.classList.toggle("is-open");
  scrim.hidden = !sidebar.classList.contains("is-open");
  if (state.view === "whatsapp") {
    if (opening) hideWhatsAppView();
    else requestAnimationFrame(() => showWhatsAppView());
  }
});
scrim.addEventListener("click", closeOverlays);

window.leadjaWhatsapp?.onStatus(({ status, message }) => {
  state.whatsappStatus = { status, message };
  const label = document.querySelector("#whatsappStatus");
  if (!label) return;
  label.textContent = message;
  label.dataset.status = status;
});

window.leadjaSocial?.onUpdate((value) => {
  if (value.state) state.social = value.state;
  if (value.post) {
    const posts = state.social.posts.filter((post) => post.id !== value.post.id);
    state.social.posts = [value.post, ...posts];
  }
  if (state.view === "publishing") renderPublishing();
});

boot();

async function boot() {
  await Promise.all([refresh(), refreshSocial()]);
  render();
}

async function refreshSocial() {
  if (!window.leadjaSocial) return;
  try { state.social = await window.leadjaSocial.state(); } catch { /* The rest of the local app remains available. */ }
}

async function refresh() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state.filters)) if (value) params.set(key, value);
  try {
    state.dashboard = await api(`/api/dashboard?${params}`);
    document.querySelector("#navLeadCount").textContent = state.dashboard.stats.total || 0;
  } catch (error) {
    app.innerHTML = errorBlock("Não foi possível abrir o banco local.", error.message);
  }
}

function render() {
  if (state.view !== "whatsapp") hideWhatsAppView();
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.view === state.view));
  document.querySelector("#mobileTitle").textContent = ({ leads: "Leads", search: "Buscar", crm: "CRM", publishing: "Publicações", whatsapp: "WhatsApp", settings: "Configurações" })[state.view];
  if (state.view === "leads") renderLeads();
  if (state.view === "search") renderSearch();
  if (state.view === "crm") renderCrm();
  if (state.view === "publishing") renderPublishing();
  if (state.view === "whatsapp") renderWhatsApp();
  if (state.view === "settings") renderSettings();
}

function renderLeads() {
  const { leads, stats } = state.dashboard;
  app.innerHTML = `
    <div class="page">
      ${pageHeading("Leads", hotFinding(stats), `<button class="button" id="importButton">${icons.download} Importar CSV</button><button class="button primary" data-view="search">${icons.plus} Nova busca</button>`)}
      <section class="kpi-strip" aria-label="Resumo dos leads">
        ${kpi("Leads salvos", stats.total, "no banco local")}
        ${kpi("Oportunidades quentes", stats.hot, "score igual ou acima de 70")}
        ${kpi("Sem site próprio", stats.noWebsite, "principal sinal comercial")}
        ${kpi("Já contatados", stats.contacted, "inclui negociações e fechados")}
      </section>
      <div class="workspace-grid">
        <section class="panel" aria-labelledby="leadListTitle">
          <div class="panel-header"><div><h2 id="leadListTitle">Prioridade de contato</h2><p>O score é calculado apenas com regras visíveis.</p></div><span class="num">${leads.length} na visualização</span></div>
          <div class="toolbar">
            <div class="toolbar-group"><input class="field" id="leadSearch" type="search" placeholder="Buscar empresa, nicho ou cidade" value="${escapeAttr(state.filters.search)}" /></div>
            <div class="toolbar-group">
              <select class="select" id="scoreFilter" aria-label="Filtrar por score"><option value="0">Todos os scores</option><option value="70" ${Number(state.filters.minScore) === 70 ? "selected" : ""}>Quentes: 70+</option><option value="50" ${Number(state.filters.minScore) === 50 ? "selected" : ""}>Promissores: 50+</option></select>
              <select class="select" id="stageFilter" aria-label="Filtrar por etapa"><option value="">Todas as etapas</option>${stageOptions(state.filters.stage)}</select>
            </div>
          </div>
          ${leads.length ? leadTable(leads) : emptyState("Nenhum lead nesta visualização", "Ajuste os filtros ou faça uma nova busca para preencher a lista.")}
        </section>
        <aside class="rail">
          <section class="rail-section"><h2>Leitura rápida</h2><div class="finding"><strong>${stats.hot ? `${stats.hot} ${stats.hot === 1 ? "lead merece" : "leads merecem"} atenção agora` : "Sua próxima oportunidade aparecerá aqui"}</strong><p>${stats.hot ? "Comece pelos que têm telefone e não possuem site próprio." : "Busque um nicho e uma cidade ou importe um CSV."}</p></div></section>
          <section class="rail-section"><h2>Funil local</h2><div class="panel rail-list">${crmStages().map(({ key, label, color }) => `<div class="rail-row"><span><i class="stage-dot" style="--stage-color:${color}"></i>${escapeHtml(label)}</span><strong>${stats.stages?.[key] || 0}</strong></div>`).join("")}</div></section>
        </aside>
      </div>
      <input id="csvInput" type="file" accept=".csv,text/csv" hidden />
    </div>`;

  document.querySelector("#leadSearch")?.addEventListener("input", debounce(async (event) => {
    state.filters.search = event.target.value;
    await refresh(); renderLeads();
  }, 250));
  document.querySelector("#scoreFilter")?.addEventListener("change", async (event) => { state.filters.minScore = Number(event.target.value); await refresh(); renderLeads(); });
  document.querySelector("#stageFilter")?.addEventListener("change", async (event) => { state.filters.stage = event.target.value; await refresh(); renderLeads(); });
  document.querySelector("#importButton")?.addEventListener("click", () => document.querySelector("#csvInput").click());
  document.querySelector("#csvInput")?.addEventListener("change", importCsv);
}

function renderSearch() {
  const searches = state.dashboard.searches || [];
  app.innerHTML = `
    <div class="page">
      ${pageHeading("Buscar empresas", "Escolha um nicho e uma cidade. O motor local consulta o Google Maps e salva apenas resultados novos.", "")}
      <div class="search-layout">
        <section class="panel form-panel">
          <h2>Nova busca</h2><p>Comece com uma consulta pequena para validar a qualidade.</p>
          <form id="searchForm">
            <div class="form-grid">
              <label class="field-label">Nicho<input class="field" name="query" required placeholder="Ex.: clínicas odontológicas" /></label>
              <label class="field-label">Cidade<input class="field" name="city" required placeholder="Ex.: Curitiba, PR" /></label>
              <label class="field-label">Limite<select class="select" name="limit"><option>10</option><option selected>30</option><option>50</option><option>100</option></select></label>
            </div>
            <div class="form-actions"><button class="button accent" type="submit">${icons.search} Buscar no Google Maps</button><button class="button" type="button" id="openMaps">Abrir busca manual</button></div>
          </form>
          <div class="search-status" id="searchStatus" aria-live="polite"></div>
        </section>
        <section class="panel history-panel">
          <h2>Buscas recentes</h2><p>O histórico permanece neste computador.</p>
          <div class="history-list">${searches.length ? searches.map(searchHistoryItem).join("") : `<div class="column-empty">Nenhuma busca executada ainda.</div>`}</div>
        </section>
      </div>
    </div>`;
  document.querySelector("#searchForm").addEventListener("submit", startSearch);
  document.querySelector("#openMaps").addEventListener("click", () => {
    const form = new FormData(document.querySelector("#searchForm"));
    const query = `${form.get("query") || "empresas"} em ${form.get("city") || "Brasil"}`;
    window.open(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, "_blank", "noopener,noreferrer");
  });
  const active = searches.find((item) => ["queued", "running"].includes(item.status));
  if (active) pollSearch(active.id);
}

function renderCrm() {
  const stages = crmStages();
  app.innerHTML = `
    <div class="page">
      ${pageHeading("CRM", "Arraste os leads entre as etapas ou abra um cartão para registrar a próxima ação.", `<button class="button primary" data-view="search">${icons.plus} Nova busca</button>`)}
      <section class="crm-board" aria-label="Funil de prospecção">
        ${stages.map(({ key, label, color }) => {
          const leads = state.dashboard.leads.filter((lead) => lead.stage === key);
          return `<div class="crm-column" data-stage="${key}" style="--stage-color:${color}"><div class="crm-column-header"><h2>${escapeHtml(label)}</h2><span>${leads.length}</span></div>${leads.length ? leads.map(leadCard).join("") : `<div class="column-empty">Solte um lead aqui.</div>`}</div>`;
        }).join("")}
      </section>
    </div>`;
  document.querySelectorAll(".lead-card").forEach((card) => card.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", card.dataset.leadId)));
  document.querySelectorAll(".crm-column").forEach((column) => {
    column.addEventListener("dragover", (event) => event.preventDefault());
    column.addEventListener("drop", async (event) => {
      event.preventDefault();
      const id = event.dataTransfer.getData("text/plain");
      await updateLead(id, { stage: column.dataset.stage });
      toast("Etapa atualizada.");
    });
  });
}

function renderPublishing() {
  if (!window.leadjaSocial) {
    app.innerHTML = `<div class="page">${pageHeading("Publicações", "Conecte suas contas e envie o mesmo vídeo para as redes escolhidas.", "")}<div class="empty-state panel"><div><strong>Disponível no aplicativo para Mac</strong><p>As conexões oficiais e o acesso ao arquivo de vídeo funcionam no LeadJá instalado.</p></div></div></div>`;
    return;
  }
  const accounts = state.social.accounts || [];
  const posts = state.social.posts || [];
  const storageReady = socialConfig("instagramStorage")?.configured;
  const hasKwai = accounts.some((account) => account.provider === "kwai");
  const privacyOptions = [...new Set(accounts.filter((account) => account.provider === "tiktok").flatMap((account) => account.metadata?.creatorInfo?.privacy_level_options || ["SELF_ONLY"]))];
  app.innerHTML = `
    <div class="page publishing-page">
      ${pageHeading("Publicações", "Conecte as contas uma vez. Depois escolha um vídeo, escreva a descrição e publique nos destinos selecionados.", `<button class="button" data-social-refresh>Atualizar contas</button>`)}
      <section class="social-connections" aria-label="Contas conectadas">
        ${socialConnectionCard("meta", "Meta", "Facebook + Instagram", "M", ["facebook", "instagram"], "Conecta as Páginas que você administra e os perfis profissionais vinculados.")}
        ${socialConnectionCard("tiktok", "TikTok", "Conta de criador", "T", ["tiktok"], "Publicação direta exige o produto Content Posting e a permissão video.publish.")}
        ${socialConnectionCard("kwai", "Kwai", "Conta de criador", "K", ["kwai"], "A conta precisa autorizar user_info e user_video_publish.")}
      </section>

      <div class="publishing-layout">
        <section class="panel composer-panel">
          <div class="panel-header"><div><h2>Nova publicação</h2><p>O envio só começa quando você confirmar.</p></div><span class="pill ${accounts.length ? "won" : "new"}">${accounts.length} ${accounts.length === 1 ? "conta" : "contas"}</span></div>
          ${accounts.length ? `
            <form id="publishForm" class="publish-form">
              <div class="video-picker ${state.socialVideo ? "has-file" : ""}">
                <span class="video-picker-icon">${icons.video}</span>
                <div><strong>${escapeHtml(state.socialVideo?.name || "Escolha um vídeo")}</strong><span>${state.socialVideo ? formatFileSize(state.socialVideo.size) : "MP4, MOV, M4V ou WebM"}</span></div>
                <button class="button" type="button" id="chooseSocialVideo">${state.socialVideo ? "Trocar" : "Selecionar vídeo"}</button>
              </div>
              <label class="field-label">Descrição<textarea class="textarea social-caption" id="socialCaption" name="caption" maxlength="2200" placeholder="Escreva uma descrição que funcione em todas as redes…"></textarea><small><span id="captionCount">0</span>/2200 caracteres</small></label>
              <fieldset class="target-fieldset"><legend>Publicar em</legend><div class="target-list">
                ${accounts.map((account) => socialTarget(account, storageReady)).join("")}
              </div></fieldset>
              ${accounts.some((account) => account.provider === "instagram") && !storageReady ? `<div class="setup-note"><div><strong>Instagram precisa de uma ponte temporária</strong><p>A API do Instagram busca o vídeo por um endereço público. Configure um bucket público do Supabase; o LeadJá envia, publica e tenta apagar o arquivo temporário.</p></div><button class="button small" type="button" data-social-config="instagramStorage">Configurar ponte</button></div>` : ""}
              ${privacyOptions.length ? `<label class="field-label">Privacidade no TikTok<select class="select" name="tiktokPrivacy">${privacyOptions.map((value) => `<option value="${escapeAttr(value)}" ${value === "SELF_ONLY" ? "selected" : ""}>${escapeHtml(tiktokPrivacyLabel(value))}</option>`).join("")}</select><small>Apps ainda não auditados pelo TikTok publicam somente como “Somente eu”.</small></label>` : ""}
              ${hasKwai ? `<div class="kwai-cover-row"><div><strong>Capa do Kwai</strong><span>${escapeHtml(state.socialCover?.name || "O LeadJá tentará gerar uma capa automaticamente. Você também pode escolher um JPG.")}</span></div><button class="button small" type="button" id="chooseSocialCover">${state.socialCover ? "Trocar capa" : "Escolher JPG"}</button></div>` : ""}
              <div class="publish-options">
                <label><input type="checkbox" name="shareToFeed" checked /> Mostrar o Reel também no feed do Instagram</label>
                <label><input type="checkbox" name="promotesOwnBusiness" /> O vídeo promove meu próprio negócio</label>
                <label><input type="checkbox" name="aiGenerated" /> O vídeo foi gerado por IA</label>
              </div>
              <div class="publish-submit"><span id="publishHint">Nada será publicado sem sua confirmação.</span><button class="button accent" type="submit" ${state.socialBusy ? "disabled" : ""}>${state.socialBusy === "publishing" ? "Publicando…" : `${icons.publish} Publicar agora`}</button></div>
            </form>` : `<div class="empty-state"><div><strong>Conecte sua primeira conta</strong><p>Configure uma rede acima e conclua a autorização na janela oficial para liberar o publicador.</p></div></div>`}
        </section>
        <aside class="panel publication-history">
          <div class="panel-header"><div><h2>Histórico</h2><p>Um resultado separado para cada destino.</p></div></div>
          <div class="post-history">${posts.length ? posts.map(socialPostItem).join("") : `<div class="column-empty">Nenhuma publicação iniciada.</div>`}</div>
        </aside>
      </div>
    </div>`;

  document.querySelector("[data-social-refresh]")?.addEventListener("click", async () => { await refreshSocial(); renderPublishing(); toast("Contas atualizadas."); });
  document.querySelectorAll("[data-social-config]").forEach((button) => button.addEventListener("click", () => openSocialConfig(button.dataset.socialConfig)));
  document.querySelectorAll("[data-social-connect]").forEach((button) => button.addEventListener("click", () => connectSocial(button.dataset.socialConnect)));
  document.querySelectorAll("[data-social-disconnect]").forEach((button) => button.addEventListener("click", () => disconnectSocial(button.dataset.socialDisconnect)));
  document.querySelector("#chooseSocialVideo")?.addEventListener("click", chooseSocialVideo);
  document.querySelector("#chooseSocialCover")?.addEventListener("click", chooseSocialCover);
  document.querySelector("#socialCaption")?.addEventListener("input", (event) => { document.querySelector("#captionCount").textContent = event.target.value.length; });
  document.querySelector("#publishForm")?.addEventListener("submit", publishSocialVideo);
}

function socialConnectionCard(configProvider, title, subtitle, monogram, providers, copy) {
  const config = socialConfig(configProvider);
  const accounts = state.social.accounts.filter((account) => providers.includes(account.provider));
  return `<article class="social-card">
    <div class="social-card-top"><span class="social-mark ${configProvider}">${monogram}</span><div><strong>${title}</strong><span>${subtitle}</span></div><span class="connection-state ${accounts.length ? "is-connected" : ""}">${accounts.length ? "Conectado" : config?.configured ? "Pronto para conectar" : "Não configurado"}</span></div>
    <p>${copy}</p>
    <div class="connected-accounts">${accounts.map((account) => `<div class="connected-account">${account.avatarUrl ? `<img src="${escapeAttr(account.avatarUrl)}" alt="" referrerpolicy="no-referrer" />` : `<span>${escapeHtml(account.label.slice(0, 1))}</span>`}<div><strong>${escapeHtml(account.label)}</strong><small>${escapeHtml(providerLabel(account.provider))}${account.username ? ` · @${escapeHtml(account.username)}` : ""}</small></div><button class="icon-button" data-social-disconnect="${escapeAttr(account.id)}" aria-label="Desconectar ${escapeAttr(account.label)}">${icons.x}</button></div>`).join("")}</div>
    <div class="social-card-actions"><button class="button small" data-social-config="${configProvider}">${config?.configured ? "Revisar configuração" : "Configurar"}</button><button class="button small primary" data-social-connect="${configProvider}" ${state.socialBusy ? "disabled" : ""}>${state.socialBusy === `connect:${configProvider}` ? "Conectando…" : accounts.length ? "Conectar outra" : "Conectar conta"}</button></div>
  </article>`;
}

function socialTarget(account, storageReady) {
  const unavailable = account.provider === "instagram" && !storageReady;
  return `<label class="social-target ${unavailable ? "is-unavailable" : ""}"><input type="checkbox" name="accountId" value="${escapeAttr(account.id)}" ${unavailable ? "disabled" : "checked"} /><span class="target-provider ${account.provider}">${providerMonogram(account.provider)}</span><span><strong>${escapeHtml(account.label)}</strong><small>${escapeHtml(providerLabel(account.provider))}${unavailable ? " · configure a ponte" : ""}</small></span><i>${icons.check}</i></label>`;
}

function socialPostItem(post) {
  return `<article class="post-item"><div class="post-item-head"><div><strong>${escapeHtml(post.videoName)}</strong><span>${formatDate(post.createdAt)} · ${socialPostStatus(post.status)}</span></div><span class="pill ${post.status === "done" ? "won" : post.status === "error" ? "lost" : post.status === "partial" ? "negotiating" : "new"}">${socialPostStatus(post.status)}</span></div><div class="post-targets">${post.targets.map((target) => {
    const account = state.social.accounts.find((value) => value.id === target.accountId);
    return `<div class="post-target"><span class="target-provider ${target.provider}">${providerMonogram(target.provider)}</span><div><strong>${escapeHtml(account?.label || providerLabel(target.provider))}</strong><small>${target.error ? escapeHtml(target.error) : socialTargetStatus(target)}</small>${["uploading", "processing", "publishing"].includes(target.status) ? `<span class="mini-progress"><i style="width:${target.progress}%"></i></span>` : ""}</div><span class="target-result ${target.status}">${target.status === "done" ? "Concluído" : target.status === "error" ? "Falhou" : `${target.progress || 0}%`}</span></div>`;
  }).join("")}</div></article>`;
}

function renderWhatsApp() {
  const pendingWhatsappUrl = state.pendingWhatsappUrl;
  state.pendingWhatsappUrl = "";
  app.innerHTML = `
    <div class="page whatsapp-page">
      ${pageHeading("WhatsApp", "Converse pelo WhatsApp Web sem sair do LeadJá. A sessão fica vinculada somente a este Mac.", `<button class="button" id="reloadWhatsapp">Recarregar</button>`)}
      <section class="whatsapp-frame" aria-label="WhatsApp Web">
        <div class="whatsapp-toolbar"><span class="status-dot"></span><strong id="whatsappStatus" data-status="${state.whatsappStatus.status}">${escapeHtml(state.whatsappStatus.message)}</strong><span>Site oficial em sessão isolada</span></div>
        <div class="whatsapp-host" id="whatsappHost">
          ${window.leadjaWhatsapp ? `<div class="whatsapp-fallback"><strong>Preparando o WhatsApp Web…</strong><p>Na primeira vez, você poderá vincular sua conta por QR Code.</p></div>` : `<div class="whatsapp-fallback"><strong>WhatsApp disponível no aplicativo para Mac</strong><p>Abra esta tela no LeadJá instalado para conectar sua conta por QR Code.</p><a class="button" href="https://web.whatsapp.com/" target="_blank" rel="noreferrer">Abrir no navegador</a></div>`}
        </div>
      </section>
    </div>`;

  document.querySelector("#reloadWhatsapp").addEventListener("click", () => window.leadjaWhatsapp?.reload());
  state.whatsappObserver?.disconnect();
  const host = document.querySelector("#whatsappHost");
  state.whatsappObserver = new ResizeObserver(() => syncWhatsAppBounds());
  state.whatsappObserver.observe(host);
  requestAnimationFrame(() => showWhatsAppView(pendingWhatsappUrl));
}

function whatsAppBounds() {
  const host = document.querySelector("#whatsappHost");
  if (!host) return null;
  const bounds = host.getBoundingClientRect();
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

function showWhatsAppView(chatUrl = "") {
  const bounds = whatsAppBounds();
  if (!bounds || !window.leadjaWhatsapp) return;
  window.leadjaWhatsapp.show(bounds, chatUrl).catch(() => setWhatsAppError());
}

function syncWhatsAppBounds() {
  const bounds = whatsAppBounds();
  if (bounds && window.leadjaWhatsapp) window.leadjaWhatsapp.setBounds(bounds).catch(() => setWhatsAppError());
}

function setWhatsAppError() {
  state.whatsappStatus = { status: "error", message: "Não foi possível abrir o WhatsApp Web." };
  const label = document.querySelector("#whatsappStatus");
  if (label) { label.textContent = state.whatsappStatus.message; label.dataset.status = "error"; }
}

function hideWhatsAppView() {
  state.whatsappObserver?.disconnect();
  state.whatsappObserver = null;
  window.leadjaWhatsapp?.hide();
}

function renderSettings() {
  const settings = state.dashboard.settings;
  const weights = settings.scoring || {};
  const theme = document.documentElement.dataset.theme || "light";
  const stages = crmStages();
  app.innerHTML = `
    <div class="page settings-list">
      ${pageHeading("Configurações", "Ajuste a oferta, a mensagem e o que torna uma oportunidade importante para você.", "")}
      <form id="settingsForm">
        <section class="settings-section">
          <div class="settings-copy"><h2>Aparência</h2><p>Escolha o tema mais confortável para trabalhar. A preferência fica salva neste computador.</p></div>
          <div class="settings-panel">
            <label class="field-label">Tema<select class="select" id="themeSelect" name="theme"><option value="light" ${theme === "light" ? "selected" : ""}>Claro</option><option value="dark" ${theme === "dark" ? "selected" : ""}>Escuro</option></select></label>
          </div>
        </section>
        <section class="settings-section">
          <div class="settings-copy"><h2>Etapas do CRM</h2><p>Renomeie, escolha as cores e mude a ordem das colunas. Os leads permanecem vinculados às etapas internas.</p></div>
          <div class="settings-panel">
            <div class="crm-stage-settings" id="crmStageSettings">
              ${stages.map((stage, index) => crmStageSetting(stage, index, stages.length)).join("")}
            </div>
          </div>
        </section>
        <section class="settings-section">
          <div class="settings-copy"><h2>Sua abordagem</h2><p>Esses dados entram nas mensagens. Nada é enviado automaticamente.</p></div>
          <div class="settings-panel">
            <label class="field-label">Seu nome<input class="field" name="senderName" value="${escapeAttr(settings.senderName || "")}" placeholder="Ex.: Álvaro" /></label>
            <label class="field-label">O que você oferece<input class="field" name="offer" value="${escapeAttr(settings.offer || "")}" /></label>
            <label class="field-label">Código do país<input class="field num" name="countryCode" inputmode="numeric" value="${escapeAttr(settings.countryCode || "55")}" /></label>
          </div>
        </section>
        <section class="settings-section">
          <div class="settings-copy"><h2>Peso do score</h2><p>Os pontos são somados e limitados a 100. A explicação fica visível em cada lead.</p></div>
          <div class="settings-panel weight-grid">
            ${weightField("noWebsite", "Sem site próprio", weights)}
            ${weightField("socialAsWebsite", "Rede social usada como site", weights)}
            ${weightField("fewReviews", "Menos de 15 avaliações", weights)}
            ${weightField("noReviews", "Nenhuma avaliação", weights)}
            ${weightField("lowRating", "Nota abaixo de 4,0", weights)}
            ${weightField("hasPhone", "Telefone disponível", weights)}
            ${weightField("insecureWebsite", "Site sem HTTPS", weights)}
          </div>
        </section>
        <div class="heading-actions"><button class="button primary" type="submit">Salvar configurações</button></div>
      </form>
    </div>`;
  document.querySelector("#settingsForm").addEventListener("submit", saveSettings);
  document.querySelector("#crmStageSettings").addEventListener("click", moveCrmStage);
  document.querySelector("#themeSelect").addEventListener("change", (event) => {
    setTheme(event.target.value);
    toast(`Tema ${event.target.value === "dark" ? "escuro" : "claro"} aplicado.`);
  });
}

function openSocialConfig(provider) {
  const config = socialConfig(provider) || { publicConfig: {}, hasSecret: false };
  const definitions = {
    meta: {
      title: "Configurar Meta",
      copy: "Use um app Business da Meta com Facebook Login e as permissões de publicação. O mesmo acesso conecta suas Páginas e os Instagrams profissionais vinculados.",
      fields: [
        ["appId", "App ID", "text", "Ex.: 1234567890"],
        ["appSecret", "App Secret", "password", config.hasSecret ? "Já salvo — deixe vazio para manter" : "Cole o App Secret"],
        ["redirectUri", "URL de retorno cadastrada", "url", "https://www.leadja.com.br/oauth/meta"],
      ],
      note: "Cadastre exatamente a URL de retorno acima no painel da Meta.",
    },
    tiktok: {
      title: "Configurar TikTok",
      copy: "Crie um app Desktop no TikTok for Developers, adicione Login Kit e Content Posting API e solicite a permissão video.publish.",
      fields: [
        ["clientKey", "Client key", "text", "Cole o Client key"],
        ["clientSecret", "Client secret", "password", config.hasSecret ? "Já salvo — deixe vazio para manter" : "Cole o Client secret"],
      ],
      note: `No TikTok, cadastre esta URL com porta curinga: http://127.0.0.1:*/oauth/tiktok`,
    },
    kwai: {
      title: "Configurar Kwai",
      copy: "Crie uma aplicação Web na Plataforma Aberta do Kwai e solicite os escopos user_info e user_video_publish.",
      fields: [
        ["appId", "App ID", "text", "Cole o App ID"],
        ["appSecret", "App Secret", "password", config.hasSecret ? "Já salvo — deixe vazio para manter" : "Cole o App Secret"],
        ["redirectUri", "URL de retorno cadastrada", "url", "https://www.leadja.com.br/oauth/kwai"],
      ],
      note: "O esquema e o subdomínio precisam ser iguais aos cadastrados no Kwai.",
    },
    instagramStorage: {
      title: "Ponte temporária do Instagram",
      copy: "O Instagram não recebe um arquivo local diretamente. Use um bucket público do Supabase Storage: o LeadJá envia o vídeo, entrega o link à Meta e tenta remover o temporário ao terminar.",
      fields: [
        ["projectUrl", "URL do projeto Supabase", "url", "https://seu-projeto.supabase.co"],
        ["bucket", "Bucket público", "text", "Ex.: leadja-temporario"],
        ["apiKey", "Chave de acesso", "password", config.hasSecret ? "Já salva — deixe vazio para manter" : "Use uma chave com acesso ao bucket"],
      ],
      note: "O plano gratuito costuma bastar para uso pessoal; limites e regras continuam sendo os do Supabase.",
    },
  };
  const definition = definitions[provider];
  if (!definition) return;
  drawer.hidden = false;
  scrim.hidden = false;
  drawer.innerHTML = `
    <div class="drawer-header"><div><h2>${definition.title}</h2><p>${definition.copy}</p></div><button class="icon-button" data-close-drawer aria-label="Fechar">${icons.x}</button></div>
    <form id="socialConfigForm" class="social-config-form" data-provider="${provider}">
      ${definition.fields.map(([key, label, type, placeholder]) => `<label class="field-label">${label}<input class="field" name="${key}" type="${type}" value="${type === "password" ? "" : escapeAttr(config.publicConfig?.[key] || (key === "redirectUri" ? placeholder : ""))}" placeholder="${escapeAttr(placeholder)}" ${type === "password" && config.hasSecret ? "" : "required"} /></label>`).join("")}
      <div class="setup-note compact"><p>${escapeHtml(definition.note)}</p></div>
      <div class="drawer-actions"><button class="button" type="button" data-close-drawer>Cancelar</button><button class="button primary" type="submit">Salvar configuração</button></div>
    </form>`;
  document.querySelector("#socialConfigForm").addEventListener("submit", saveSocialConfig);
}

async function saveSocialConfig(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const value = Object.fromEntries(new FormData(form));
  try {
    state.social = await window.leadjaSocial.saveConfig(form.dataset.provider, value);
    await refreshSocial();
    closeOverlays();
    renderPublishing();
    toast("Configuração salva neste Mac.");
  } catch (error) { toast(error.message); }
}

async function connectSocial(provider) {
  state.socialBusy = `connect:${provider}`;
  renderPublishing();
  try {
    state.social = await window.leadjaSocial.connect(provider);
    await refreshSocial();
    toast("Conta conectada.");
  } catch (error) { toast(error.message); }
  finally { state.socialBusy = ""; renderPublishing(); }
}

async function disconnectSocial(accountId) {
  const account = state.social.accounts.find((value) => value.id === accountId);
  if (!account || !window.confirm(`Desconectar “${account.label}” do publicador? O histórico será preservado.`)) return;
  try {
    state.social = await window.leadjaSocial.disconnect(accountId);
    await refreshSocial();
    renderPublishing();
    toast("Conta desconectada.");
  } catch (error) { toast(error.message); }
}

async function chooseSocialVideo() {
  const file = await window.leadjaSocial.chooseVideo();
  if (!file) return;
  state.socialVideo = file;
  renderPublishing();
}

async function chooseSocialCover() {
  const file = await window.leadjaSocial.chooseCover();
  if (!file) return;
  state.socialCover = file;
  renderPublishing();
}

async function publishSocialVideo(event) {
  event.preventDefault();
  if (!state.socialVideo) return toast("Escolha o vídeo antes de publicar.");
  const data = new FormData(event.currentTarget);
  const accountIds = data.getAll("accountId");
  if (!accountIds.length) return toast("Selecione ao menos uma conta.");
  const caption = String(data.get("caption") || "").trim();
  const names = accountIds.map((id) => state.social.accounts.find((account) => account.id === id)?.label).filter(Boolean);
  if (!window.confirm(`Publicar “${state.socialVideo.name}” em ${names.length} ${names.length === 1 ? "conta" : "contas"}?`)) return;
  state.socialBusy = "publishing";
  renderPublishing();
  try {
    await window.leadjaSocial.publish({
      videoPath: state.socialVideo.path,
      coverPath: state.socialCover?.path || "",
      caption,
      accountIds,
      tiktokPrivacy: data.get("tiktokPrivacy") || "SELF_ONLY",
      shareToFeed: data.get("shareToFeed") === "on",
      promotesOwnBusiness: data.get("promotesOwnBusiness") === "on",
      aiGenerated: data.get("aiGenerated") === "on",
    });
    await refreshSocial();
    state.socialVideo = null;
    state.socialCover = null;
    const last = state.social.posts[0];
    toast(last?.status === "done" ? "Publicação concluída em todos os destinos." : "Publicação concluída com itens que precisam de atenção.");
  } catch (error) { toast(error.message); }
  finally { state.socialBusy = ""; renderPublishing(); }
}

async function handleClick(event) {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    state.view = viewButton.dataset.view;
    sidebar.classList.remove("is-open"); scrim.hidden = true;
    render();
    return;
  }
  const leadTarget = event.target.closest("[data-lead-id]");
  if (leadTarget && !event.target.closest("a,button,select,textarea")) openLead(Number(leadTarget.dataset.leadId));
  if (event.target.closest("[data-close-drawer]")) closeOverlays();
}

async function openLead(id) {
  const lead = await api(`/api/leads/${id}`);
  state.activeLeadId = id;
  drawer.hidden = false;
  scrim.hidden = false;
  drawer.innerHTML = `
    <div class="drawer-header"><div><h2>${escapeHtml(lead.name)}</h2><p>${escapeHtml(lead.category || "Empresa local")} · ${escapeHtml(lead.city || "Cidade não informada")}</p></div><button class="icon-button" data-close-drawer aria-label="Fechar">${icons.x}</button></div>
    <div class="drawer-score"><strong class="num">${lead.score}</strong><span>de 100 no score de oportunidade</span></div>
    <div class="receipt">${lead.scoreReasons.length ? lead.scoreReasons.map((reason) => `<div class="receipt-row"><span>${escapeHtml(reason.label)}</span><strong>+${reason.value}</strong></div>`).join("") : `<div class="receipt-row"><span>Nenhum sinal configurado</span><strong>0</strong></div>`}</div>
    <dl class="detail-grid"><dt>Telefone</dt><dd>${escapeHtml(lead.phone || "—")}</dd><dt>Site</dt><dd>${lead.website ? `<a href="${escapeAttr(lead.website)}" target="_blank" rel="noreferrer">${escapeHtml(lead.website)}</a>` : "—"}</dd><dt>Avaliações</dt><dd>${lead.rating ? `${lead.rating.toFixed(1)} com ${lead.reviewCount} avaliações` : `${lead.reviewCount} avaliações`}</dd><dt>Endereço</dt><dd>${escapeHtml(lead.address || "—")}</dd><dt>Google Maps</dt><dd><a href="${escapeAttr(lead.googleMapsUrl)}" target="_blank" rel="noreferrer">Abrir no Google Maps ↗</a></dd></dl>
    <div class="drawer-utility-actions"><button class="button" id="shareLead">${icons.share} Compartilhar lead</button></div>
    <section class="drawer-section"><h3>Etapa</h3><select class="select" id="drawerStage">${stageOptions(lead.stage)}</select></section>
    <section class="drawer-section"><h3>Mensagem sugerida</h3><textarea class="textarea" id="drawerMessage">${escapeHtml(lead.message)}</textarea><button class="button text" id="copyMessage">Copiar mensagem</button></section>
    <section class="drawer-section"><h3>Anotações</h3><textarea class="textarea" id="drawerNote" placeholder="Próxima ação, resposta ou contexto...">${escapeHtml(lead.note || "")}</textarea></section>
    <section class="drawer-section danger-zone"><h3>Remover do CRM</h3><p>Esta ação exclui o lead da lista e do funil local.</p><button class="button danger" id="deleteLead">Excluir lead</button></section>
    <div class="drawer-actions">${lead.whatsappUrl ? `<button class="button accent" id="openWhatsapp">Conversar no WhatsApp ${icons.arrow}</button>` : `<button class="button" disabled>Telefone indisponível</button>`}<button class="button primary" id="saveLead">Salvar</button></div>`;
  document.querySelector("#copyMessage").addEventListener("click", async () => {
    await navigator.clipboard.writeText(document.querySelector("#drawerMessage").value);
    toast("Mensagem copiada.");
  });
  document.querySelector("#shareLead").addEventListener("click", async () => {
    const text = leadShareText(lead);
    if (window.leadjaShare) await window.leadjaShare.open({ text, url: lead.googleMapsUrl });
    else { await navigator.clipboard.writeText(text); toast("Dados do lead copiados."); }
  });
  document.querySelector("#openWhatsapp")?.addEventListener("click", () => {
    const whatsappUrl = new URL(lead.whatsappUrl);
    whatsappUrl.searchParams.set("text", document.querySelector("#drawerMessage").value.trim());
    state.pendingWhatsappUrl = whatsappUrl.toString();
    state.view = "whatsapp";
    closeOverlays();
    render();
  });
  document.querySelector("#saveLead").addEventListener("click", async () => {
    await updateLead(id, { stage: document.querySelector("#drawerStage").value, note: document.querySelector("#drawerNote").value });
    closeOverlays(); toast("Lead atualizado.");
  });
  document.querySelector("#deleteLead").addEventListener("click", async () => {
    if (!window.confirm(`Excluir “${lead.name}” do CRM? Esta ação não pode ser desfeita.`)) return;
    await api(`/api/leads/${id}`, { method: "DELETE" });
    closeOverlays();
    await refresh();
    render();
    toast("Lead excluído.");
  });
}

async function updateLead(id, patch) {
  await api(`/api/leads/${id}`, { method: "PATCH", body: patch });
  await refresh();
  render();
}

async function startSearch(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const status = document.querySelector("#searchStatus");
  status.className = "search-status is-visible";
  status.innerHTML = `<strong>Preparando o motor local</strong><span>O navegador local será aberto em segundo plano para consultar o Google Maps.</span><div class="progress-track"><i></i></div>`;
  try {
    const job = await api("/api/searches", { method: "POST", body: Object.fromEntries(form) });
    pollSearch(job.id);
  } catch (error) {
    status.innerHTML = `<strong>A busca não começou</strong><span>${escapeHtml(error.message)}</span>`;
  }
}

function pollSearch(id) {
  clearInterval(state.polling);
  const check = async () => {
    const job = await api(`/api/searches/${id}`);
    const status = document.querySelector("#searchStatus");
    if (status) {
      status.className = "search-status is-visible";
      if (["queued", "running"].includes(job.status)) status.innerHTML = `<strong>Buscando ${escapeHtml(job.query)} em ${escapeHtml(job.city)}</strong><span>Os resultados aparecem assim que o Google Maps concluir a coleta.</span><div class="progress-track"><i></i></div>`;
      if (job.status === "done") status.innerHTML = `<strong>Busca concluída</strong><span>${job.resultCount} leads foram processados e deduplicados.</span>`;
      if (job.status === "error") status.innerHTML = `<strong>Não foi possível concluir</strong><span>${escapeHtml(job.error)}</span>`;
    }
    if (["done", "error"].includes(job.status)) {
      clearInterval(state.polling); state.polling = null; await refresh();
      if (state.view === "search") renderSearch();
      toast(job.status === "done" ? `${job.resultCount} leads adicionados.` : "A busca precisa de atenção.");
    }
  };
  check();
  state.polling = setInterval(check, 2500);
}

async function importCsv(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const result = await api("/api/leads/import", { method: "POST", body: { csv: await file.text() } });
    await refresh(); renderLeads(); toast(`${result.imported} leads importados.`);
  } catch (error) { toast(error.message); }
}

async function saveSettings(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const scoring = {};
  for (const [key, value] of data.entries()) if (key.startsWith("score.")) scoring[key.slice(6)] = Number(value);
  const stageKeys = data.getAll("crm.key");
  const stageLabels = data.getAll("crm.label");
  const stageColors = data.getAll("crm.color");
  const crmStages = stageKeys.map((key, index) => ({
    key,
    label: String(stageLabels[index] || "").trim() || defaultCrmStages.find((stage) => stage.key === key)?.label || key,
    color: normalizeStageColor(stageColors[index], defaultCrmStages.find((stage) => stage.key === key)?.color),
  }));
  await api("/api/settings", { method: "PUT", body: { senderName: data.get("senderName"), offer: data.get("offer"), countryCode: data.get("countryCode"), scoring, crmStages } });
  await refresh(); renderSettings(); toast("Configurações salvas.");
}

function moveCrmStage(event) {
  const button = event.target.closest("[data-stage-move]");
  if (!button) return;
  const row = button.closest(".crm-stage-setting");
  if (button.dataset.stageMove === "up" && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
  if (button.dataset.stageMove === "down" && row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
  updateCrmStageButtons();
}

function updateCrmStageButtons() {
  const rows = [...document.querySelectorAll(".crm-stage-setting")];
  rows.forEach((row, index) => {
    row.querySelector('[data-stage-move="up"]').disabled = index === 0;
    row.querySelector('[data-stage-move="down"]').disabled = index === rows.length - 1;
  });
}

function leadTable(leads) {
  return `<table class="lead-table"><thead><tr><th class="identity">Empresa</th><th class="location">Localização</th><th class="num reviews">Avaliações</th><th class="status-col">Etapa</th><th class="num score-col">Score</th><th class="action-col"></th></tr></thead><tbody>${leads.map((lead) => `<tr data-lead-id="${lead.id}"><td class="identity"><span class="lead-name">${escapeHtml(lead.name)}</span><span class="lead-subline">${escapeHtml(lead.category || "Categoria não informada")}${lead.website ? " · com site" : " · sem site"}</span></td><td class="location">${escapeHtml(lead.city || lead.address || "—")}</td><td class="num reviews">${lead.rating ? lead.rating.toFixed(1) : "—"} <span class="lead-subline">${lead.reviewCount} avaliações</span></td><td class="status-col"><span class="pill" style="${stagePillStyle(lead.stage)}">${escapeHtml(stageLabel(lead.stage))}</span></td><td class="num score-col"><span class="score ${scoreClass(lead.score)}">${lead.score}</span></td><td class="action-col">${icons.arrow}</td></tr>`).join("")}</tbody></table>`;
}

function leadCard(lead) {
  return `<article class="lead-card" draggable="true" data-lead-id="${lead.id}"><strong>${escapeHtml(lead.name)}</strong><span>${escapeHtml(lead.category || "Empresa local")} · ${escapeHtml(lead.city || "Sem cidade")}</span><div class="card-footer"><span>${lead.phone ? "WhatsApp disponível" : "Sem telefone"}</span><span class="score ${scoreClass(lead.score)}">${lead.score}</span></div></article>`;
}

function searchHistoryItem(item) {
  const label = item.status === "done" ? `${item.resultCount} leads` : item.status === "error" ? "Falhou" : "Em andamento";
  return `<div class="history-item"><div><strong>${escapeHtml(item.query)}</strong><span>${escapeHtml(item.city)} · ${formatDate(item.createdAt)}</span></div><span class="pill ${item.status === "done" ? "won" : item.status === "error" ? "lost" : "qualified"}">${label}</span></div>`;
}

function pageHeading(title, subtitle, actions) {
  return `<header class="page-heading"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ""}</header>`;
}

function kpi(label, value, caption) { return `<div class="kpi"><span>${label}</span><strong>${Number(value || 0).toLocaleString("pt-BR")}</strong><small>${caption}</small></div>`; }
function hotFinding(stats) { return stats.hot ? `${stats.hot} ${stats.hot === 1 ? "oportunidade está" : "oportunidades estão"} pronta para contato; a lista já começa pelas mais fortes.` : "Seus leads ficam ordenados pelos sinais que mais importam para a sua oferta."; }
function emptyState(title, copy) { return `<div class="empty-state"><div><strong>${title}</strong><p>${copy}</p><button class="button primary" data-view="search">Fazer uma busca</button></div></div>`; }
function errorBlock(title, copy) { return `<div class="empty-state"><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(copy)}</p><button class="button" onclick="location.reload()">Tentar novamente</button></div></div>`; }
function socialConfig(provider) { return state.social.configs?.find((config) => config.provider === provider); }
function providerLabel(provider) { return ({ facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", kwai: "Kwai" })[provider] || provider; }
function providerMonogram(provider) { return ({ facebook: "f", instagram: "I", tiktok: "T", kwai: "K" })[provider] || "•"; }
function socialPostStatus(status) { return ({ queued: "Na fila", running: "Em andamento", done: "Concluída", partial: "Atenção", error: "Falhou" })[status] || status; }
function socialTargetStatus(target) { return ({ queued: "Aguardando", uploading: "Enviando vídeo", processing: "Processando", publishing: "Publicando", done: "Publicado", error: "Falhou" })[target.status] || target.status; }
function tiktokPrivacyLabel(value) { return ({ PUBLIC_TO_EVERYONE: "Público", MUTUAL_FOLLOW_FRIENDS: "Amigos mútuos", FOLLOWER_OF_CREATOR: "Seguidores", SELF_ONLY: "Somente eu" })[value] || value; }
function formatFileSize(value) { const bytes = Number(value || 0); return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }
function crmStages() {
  const saved = Array.isArray(state.dashboard.settings?.crmStages) ? state.dashboard.settings.crmStages : [];
  const defaults = new Map(defaultCrmStages.map((stage) => [stage.key, stage]));
  const ordered = [];
  for (const value of saved) {
    if (!defaults.has(value?.key) || ordered.some((stage) => stage.key === value.key)) continue;
    const fallback = defaults.get(value.key);
    ordered.push({ key: value.key, label: String(value.label || fallback.label).trim().slice(0, 40) || fallback.label, color: normalizeStageColor(value.color, fallback.color) });
  }
  for (const stage of defaultCrmStages) if (!ordered.some((value) => value.key === stage.key)) ordered.push({ ...stage });
  return ordered;
}

function stageLabel(key) { return crmStages().find((stage) => stage.key === key)?.label || (key === "lost" ? "Perdido" : key); }
function stageColor(key) { return crmStages().find((stage) => stage.key === key)?.color || "#64748b"; }
function stagePillStyle(key) { const color = stageColor(key); return `color:${color};border-color:${color}55;background:${color}14`; }
function normalizeStageColor(value, fallback = "#64748b") { return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : fallback; }
function stageOptions(selected) { return [...crmStages(), { key: "lost", label: "Perdido", color: "#b91c1c" }].map(({ key, label }) => `<option value="${key}" ${selected === key ? "selected" : ""}>${escapeHtml(label)}</option>`).join(""); }
function crmStageSetting(stage, index, total) { return `<div class="crm-stage-setting"><input type="hidden" name="crm.key" value="${stage.key}"/><input class="crm-color" type="color" name="crm.color" value="${stage.color}" aria-label="Cor de ${escapeAttr(stage.label)}"/><input class="field" name="crm.label" value="${escapeAttr(stage.label)}" maxlength="40" aria-label="Nome da etapa ${escapeAttr(stage.label)}"/><div class="crm-stage-order"><button class="icon-button" type="button" data-stage-move="up" aria-label="Mover ${escapeAttr(stage.label)} para cima" ${index === 0 ? "disabled" : ""}>↑</button><button class="icon-button" type="button" data-stage-move="down" aria-label="Mover ${escapeAttr(stage.label)} para baixo" ${index === total - 1 ? "disabled" : ""}>↓</button></div></div>`; }
function leadShareText(lead) { return [lead.name, [lead.category, lead.city].filter(Boolean).join(" · "), lead.phone ? `Telefone: ${lead.phone}` : "", lead.website ? `Site: ${lead.website}` : "", lead.googleMapsUrl ? `Google Maps: ${lead.googleMapsUrl}` : "", `Etapa: ${stageLabel(lead.stage)}`, `Score: ${lead.score}/100`].filter(Boolean).join("\n"); }
function weightField(key, label, weights) { return `<label for="score-${key}">${label}</label><input class="field num" id="score-${key}" name="score.${key}" type="number" min="0" max="100" value="${Number(weights[key] || 0)}" />`; }
function scoreClass(score) { return score >= 70 ? "hot" : score >= 50 ? "warm" : "low"; }
function formatDate(value) { return value ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(`${value.replace(" ", "T")}Z`)) : "—"; }

function closeOverlays() {
  drawer.hidden = true; drawer.innerHTML = ""; sidebar.classList.remove("is-open"); scrim.hidden = true; state.activeLeadId = null;
  if (state.view === "whatsapp") requestAnimationFrame(() => showWhatsAppView());
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || "A operação não foi concluída.");
  return value;
}

function toast(message) {
  toastEl.textContent = message; toastEl.classList.add("is-visible");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => toastEl.classList.remove("is-visible"), 2600);
}

function setTheme(value) {
  const theme = value === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("leadja-theme", theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0b0e0d" : "#edf5f1");
}

function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function escapeAttr(value) { return escapeHtml(value); }

