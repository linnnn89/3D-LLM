/**
 * 独立设置窗口逻辑（settings.html）
 * ---------------------------------
 * 与主视口（app.js）分离的原因：设置是"低频、全局"的操作，
 * 独立成窗口后主视口不再承载 700 行表单逻辑，也避免遮挡 3D 画面。
 *
 * 与旧内嵌面板的**关键差异**：
 *  1. LLM / API 提供商是**全局共用**的，数据源为 /api/settings/config 返回的
 *     `global_llm`（来自 conf.yaml 的 agent_config.llm_configs），
 *     而不是每个角色 yaml 里的 llm_settings。
 *  2. 保存 LLM 会写进全局 conf.yaml；保存 TTS/人设写进角色 yaml。
 *  3. 保存完成后不再依赖 WebSocket，改用 localStorage 事件通知主视口刷新。
 */

const SETTINGS_CHANNEL_KEY = 'vtuber:settings-updated';

/** 当前页面模式：'global'（全局设置，对所有角色生效）或 'character'（角色设置） */
const SETTINGS_PAGE = document.body.dataset.settingsPage || 'global';
const IS_GLOBAL = SETTINGS_PAGE === 'global';

let settingsData = {
  providers: null,
  config: null,
  keysStatus: {},
  storagePath: null,
};

/** 当前要编辑的角色档案（由主视口通过 URL 参数传入） */
let targetCharacter = new URLSearchParams(location.search).get('character') || '';

/** 打开另一个设置窗口（全局 <-> 角色） */
async function openOtherSettingsWindow() {
  const other = IS_GLOBAL ? 'character' : 'settings';
  const query = targetCharacter ? `?character=${encodeURIComponent(targetCharacter)}` : '';
  try {
    const res = await fetch(
      `/api/settings/open-window?page=${other}${targetCharacter ? `&character=${encodeURIComponent(targetCharacter)}` : ''}`,
      { method: 'POST' }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return;
  } catch (e) {
    console.warn('后端拉起窗口失败，退化为浏览器弹窗:', e.message);
  }
  const file = IS_GLOBAL ? './character.html' : './settings.html';
  window.open(`${file}${query}`, 'vtuber-settings', 'width=1020,height=780');
}

function setStatus(msg, isError = false) {
  const el = document.getElementById('save-status-msg');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#f87171' : '';
}

/** 通知主视口：配置已变更（主视口监听 storage 事件后重新拉取配置并切换角色） */
function notifyMainViewport() {
  try {
    localStorage.setItem(
      SETTINGS_CHANNEL_KEY,
      JSON.stringify({ at: Date.now(), character: targetCharacter })
    );
  } catch (e) {
    console.warn('无法通过 localStorage 通知主视口:', e);
  }
}

// ---------------------------------------------------------------- 数据加载

async function loadSettingsFromServer() {
  try {
    const provRes = await fetch('/api/settings/providers');
    if (provRes.ok) settingsData.providers = await provRes.json();

    const keysRes = await fetch('/api/settings/keys');
    if (keysRes.ok) {
      const kd = await keysRes.json();
      settingsData.keysStatus = kd.status || {};
    }

    const storageRes = await fetch('/api/settings/storage-path');
    if (storageRes.ok) settingsData.storagePath = await storageRes.json();

    const confRes = await fetch(
      `/api/settings/config?character=${encodeURIComponent(targetCharacter)}`
    );
    if (confRes.ok) settingsData.config = await confRes.json();

    renderSettingsUI(true);
  } catch (err) {
    console.error('Failed to load settings:', err);
    setStatus('❌ 无法连接到后端服务，请确认服务已启动', true);
  }
}

// ---------------------------------------------------------------- 渲染

function renderSettingsUI(updateCharDropdown = true) {
  if (!settingsData.config) return;
  const cfg = settingsData.config;
  const defaults = cfg.defaults || {};
  const charOverrides = cfg.user_overrides || {};
  const memoryOverrides = cfg.memory_overrides || {};

  // 角色下拉（仅影响人设与声音）
  const charSelect = document.getElementById('setting-char-select');
  if (updateCharDropdown && charSelect && cfg.character_files) {
    const want = targetCharacter || cfg.target_character;
    charSelect.innerHTML = '';
    let matched = false;
    cfg.character_files.forEach((f) => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f.replace('.yaml', '').replace('zh_', '');
      if (f === want) {
        opt.selected = true;
        matched = true;
      }
      charSelect.appendChild(opt);
    });
    // URL 传入的角色名对不上（或被清空）时，退回列表首项，避免出现"没有选中项"的错乱
    if (!matched && charSelect.options.length > 0) {
      charSelect.selectedIndex = 0;
    }
    targetCharacter = charSelect.value || want;
  }

  // 角色页的顶部概要区（仅角色页存在这些元素）
  const heroTitle = document.getElementById('char-hero-title');
  if (heroTitle) {
    const label = (targetCharacter || '')
      .replace('.yaml', '')
      .replace(/^(zh_|en_)/, '');
    heroTitle.textContent = label || '未选择角色';
    const heroAvatar = document.getElementById('char-hero-avatar');
    if (heroAvatar) heroAvatar.textContent = label ? label.slice(0, 1) : '角';
    const heroSub = document.getElementById('char-hero-sub');
    if (heroSub) {
      heroSub.textContent = `正在编辑「${label}」的人设与声音；API 端点与密钥为全局共用。`;
    }
  }

  const charConfig = (cfg.character_conf && cfg.character_conf.character_config) || {};

  // ===== 1. LLM（全局共用）=====
  const globalLlm = cfg.global_llm || {};
  const globalLlmOverrides = cfg.global_llm_overrides || {};

  const baseUrlInput = document.getElementById('llm-base-url');
  const modelInput = document.getElementById('llm-model');
  const tempInput = document.getElementById('llm-temperature');
  const tempVal = document.getElementById('temp-val');
  const personaInput = document.getElementById('llm-persona-prompt');

  const defaultBaseUrl = (defaults.llm && defaults.llm.base_url) || 'https://api.deepseek.com/v1';
  const defaultModel = (defaults.llm && defaults.llm.model) || 'deepseek-chat';
  const defaultTemp =
    defaults.llm && defaults.llm.temperature !== undefined ? defaults.llm.temperature : 0.7;

  if (baseUrlInput) {
    const activeUrl =
      globalLlmOverrides.base_url ||
      (globalLlm.base_url && globalLlm.base_url !== defaultBaseUrl ? globalLlm.base_url : '');
    baseUrlInput.value = activeUrl || '';
    baseUrlInput.placeholder = `系统默认: ${defaultBaseUrl}`;
  }
  if (modelInput) {
    const activeModel =
      globalLlmOverrides.model ||
      (globalLlm.model && globalLlm.model !== defaultModel ? globalLlm.model : '');
    modelInput.value = activeModel || '';
    modelInput.placeholder = `系统默认: ${defaultModel}`;
  }
  if (tempInput) {
    const activeTemp =
      globalLlmOverrides.temperature !== undefined
        ? globalLlmOverrides.temperature
        : globalLlm.temperature !== undefined
        ? globalLlm.temperature
        : defaultTemp;
    tempInput.value = activeTemp;
    if (tempVal) tempVal.textContent = activeTemp;
  }
  if (personaInput) {
    personaInput.value = charOverrides.persona_prompt || charConfig.persona_prompt || '';
  }

  // Provider 预设下拉回显
  const providerPreset = document.getElementById('llm-provider-preset');
  if (providerPreset) {
    const currentUrl = (baseUrlInput && baseUrlInput.value) || defaultBaseUrl;
    if (currentUrl.includes('deepseek.com')) providerPreset.value = 'deepseek';
    else if (currentUrl.includes('openrouter.ai')) providerPreset.value = 'openrouter';
    else if (currentUrl.includes('commandcode.ai')) providerPreset.value = 'commandcode';
    else if (currentUrl.includes('opencode.ai')) providerPreset.value = 'opencode';
    else providerPreset.value = 'custom';
  }

  // LLM Key 状态
  const llmKeyStatus = document.getElementById('llm-key-status');
  if (llmKeyStatus) {
    const isConfigured =
      settingsData.keysStatus['deepseek'] ||
      settingsData.keysStatus['openrouter'] ||
      settingsData.keysStatus['commandcode'] ||
      settingsData.keysStatus['opencode'] ||
      settingsData.keysStatus['custom'];
    if (isConfigured) {
      llmKeyStatus.innerHTML = `🛡️ <span style="color:#4ade80">已在 Windows DPAPI 保险库中安全配置 (掩码: ${isConfigured.masked})</span>`;
    } else {
      llmKeyStatus.innerHTML = `⚠️ <span style="color:#f87171">尚未配置 API Key，请在下方输入并保存</span>`;
    }
  }

  // ===== 2. TTS：引擎与全部合成参数**全局共用**，只有音色随角色 =====
  const gTts = cfg.global_tts || {}; // 全局（conf.yaml 的 character_config.tts_config）
  const fishCfg = gTts.fish_api_tts || {};
  const edgeCfg = gTts.edge_tts || {};
  const roleTts = charOverrides.tts || {}; // 角色覆盖：只可能含音色

  const ttsEngineSelect = document.getElementById('tts-engine-select');
  const activeTtsEngine =
    gTts.tts_model || (defaults.tts && defaults.tts.provider) || 'fish_api_tts';
  if (ttsEngineSelect) {
    ttsEngineSelect.value = activeTtsEngine;
    toggleTtsPanel(activeTtsEngine);
  }

  const fishModel = document.getElementById('fish-model');
  const fishRefId = document.getElementById('fish-reference-id');
  const fishLatency = document.getElementById('fish-latency');
  const fishMode = document.getElementById('fish-mode');
  const fishBaseUrl = document.getElementById('fish-base-url');
  const edgeVoice = document.getElementById('edge-voice');

  const defFishModel = (defaults.tts && defaults.tts.model) || 's2.1-pro-free';
  const defFishRef = (defaults.tts && defaults.tts.reference_id) || '7f92f8afb8ec43bf81429cc1c9199cb1';
  const defFishLat = (defaults.tts && defaults.tts.latency) || 'balanced';
  const defFishMode = (defaults.tts && defaults.tts.mode) || 'standard';
  const defFishBase = (defaults.tts && defaults.tts.base_url) || 'https://api.fish.audio';

  // —— 全局参数（来自 conf.yaml，对所有角色一致）
  if (fishModel) fishModel.value = fishCfg.model || defFishModel;
  if (fishLatency) fishLatency.value = fishCfg.latency || defFishLat;
  if (fishMode) fishMode.value = fishCfg.mode || defFishMode;
  if (fishBaseUrl) {
    fishBaseUrl.value = fishCfg.base_url || '';
    fishBaseUrl.placeholder = `系统默认: ${defFishBase}`;
  }

  // —— 音色（角色级：唯一随角色走的 TTS 设置）
  if (fishRefId) {
    fishRefId.value = roleTts.reference_id || '';
    fishRefId.placeholder = `系统默认: ${defFishRef}`;
  }
  if (edgeVoice) {
    edgeVoice.value = roleTts.voice || edgeCfg.voice || 'ja-JP-NanamiNeural';
  }

  // 输出格式 / 情感表现力 / 核采样 / 语速
  const fishFormat = document.getElementById('fish-format');
  if (fishFormat) {
    fishFormat.value =
      (charOverrides.tts && charOverrides.tts.format) ||
      fishCfg.format ||
      (defaults.tts && defaults.tts.format) ||
      'wav';
  }
  const fishNumFields = [
    ['fish-temperature', 'temperature', 'fish-temp-val', (v) => v.toFixed(2)],
    ['fish-top-p', 'top_p', 'fish-topp-val', (v) => v.toFixed(2)],
    ['fish-speed', 'speed', 'fish-speed-val', (v) => `${v.toFixed(2)}x`],
  ];
  fishNumFields.forEach(([id, key, labelId, fmt]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const fromOverride = charOverrides.tts ? charOverrides.tts[key] : undefined;
    const fromCfg = fishCfg[key];
    const defVal = (defaults.tts && defaults.tts[key] != null) ? defaults.tts[key] : el.defaultValue;
    const v = fromOverride != null ? fromOverride : (fromCfg != null ? fromCfg : defVal);
    el.value = v;
    const label = document.getElementById(labelId);
    if (label) label.textContent = fmt(Number(v));
  });

  const fishKeyStatus = document.getElementById('fish-key-status');
  if (fishKeyStatus) {
    const isFishKey = settingsData.keysStatus['fish_audio'] || settingsData.keysStatus['fish.audio'];
    if (isFishKey) {
      fishKeyStatus.innerHTML = `🛡️ <span style="color:#4ade80">已在 DPAPI 保险库中安全加密 (${isFishKey.masked})</span>`;
    } else {
      fishKeyStatus.innerHTML = `⚠️ <span style="color:#f87171">尚未配置 Fish Audio 密钥</span>`;
    }
  }

  // ===== 3. Memory =====
  const defMem = defaults.memory || {};
  const bind = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  };
  const memAuto = document.getElementById('mem-auto-generate');
  if (memAuto) {
    memAuto.checked =
      memoryOverrides.auto_generate_enabled !== undefined
        ? memoryOverrides.auto_generate_enabled
        : defMem.auto_generate_enabled !== undefined
        ? defMem.auto_generate_enabled
        : true;
  }
  const memInterval = document.getElementById('mem-update-interval');
  if (memInterval) {
    memInterval.value = memoryOverrides.update_interval_turns !== undefined ? memoryOverrides.update_interval_turns : '';
    memInterval.placeholder = `系统默认: ${defMem.update_interval_turns ?? 10}`;
  }
  const memMaxUserTurns = document.getElementById('mem-max-user-turns');
  if (memMaxUserTurns) {
    memMaxUserTurns.value = memoryOverrides.maximum_source_user_turns !== undefined ? memoryOverrides.maximum_source_user_turns : '';
    memMaxUserTurns.placeholder = `系统默认: ${defMem.maximum_source_user_turns ?? 10}`;
  }
  const memTargetTokens = document.getElementById('mem-target-tokens');
  if (memTargetTokens) {
    memTargetTokens.value = memoryOverrides.target_tokens !== undefined ? memoryOverrides.target_tokens : '';
    memTargetTokens.placeholder = `系统默认: ${defMem.target_tokens ?? 0} (无上限/自适应压缩)`;
  }
  const memRetrievalEnabled = document.getElementById('mem-retrieval-enabled');
  if (memRetrievalEnabled) {
    memRetrievalEnabled.checked =
      memoryOverrides.retrieval_enabled !== undefined
        ? memoryOverrides.retrieval_enabled
        : defMem.retrieval_enabled !== undefined
        ? defMem.retrieval_enabled
        : true;
  }
  const memRetrievalScope = document.getElementById('mem-retrieval-scope');
  if (memRetrievalScope) {
    memRetrievalScope.value = memoryOverrides.retrieval_scope || defMem.retrieval_scope || 'current_conversation';
  }
  const memRecentCount = document.getElementById('mem-recent-count');
  if (memRecentCount) {
    memRecentCount.value = memoryOverrides.retrieval_recent_count !== undefined ? memoryOverrides.retrieval_recent_count : '';
    memRecentCount.placeholder = `系统默认: ${defMem.retrieval_recent_count ?? 20}`;
  }
  const memMaxResults = document.getElementById('mem-max-results');
  if (memMaxResults) {
    memMaxResults.value = memoryOverrides.retrieval_max_results !== undefined ? memoryOverrides.retrieval_max_results : '';
    memMaxResults.placeholder = `系统默认: ${defMem.retrieval_max_results ?? 6}`;
  }
  const memTokenBudget = document.getElementById('mem-token-budget');
  if (memTokenBudget) {
    memTokenBudget.value = memoryOverrides.retrieval_token_budget !== undefined ? memoryOverrides.retrieval_token_budget : '';
    memTokenBudget.placeholder = `系统默认: ${defMem.retrieval_token_budget ?? 1200}`;
  }

  // ===== 4. Storage =====
  const storagePathInput = document.getElementById('storage-path-input');
  const storageDefaultHint = document.getElementById('storage-default-hint');
  const currentPath = (settingsData.storagePath && settingsData.storagePath.current_path) || cfg.user_data_dir || '';
  const defaultPath =
    (settingsData.storagePath && settingsData.storagePath.default_path) ||
    cfg.default_user_data_dir ||
    'E:\\我的文档\\LLM-3D-CHAT';
  if (storagePathInput) {
    storagePathInput.value = currentPath;
    storagePathInput.placeholder = `当前目录: ${currentPath}`;
  }
  if (storageDefaultHint) {
    storageDefaultHint.innerHTML = `系统默认路径: <code>${defaultPath}</code> (通过 Windows Shell 动态获取)`;
  }

  renderVaultCards();
  bindFieldResetHandlers();
}

// ---------------------------------------------------------------- 交互绑定

function bindFieldResetHandlers() {
  document.querySelectorAll('.btn-field-reset').forEach((btn) => {
    if (btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute('data-reset');
      if (!targetId) return;

      const cfg = settingsData.config || {};
      const defaults = cfg.defaults || {};
      const charConfig = (cfg.character_conf && cfg.character_conf.character_config) || {};
      const input = document.getElementById(targetId);
      if (!input) return;

      switch (targetId) {
        case 'llm-provider-preset':
          input.value = 'deepseek';
          onProviderPresetChange('deepseek');
          break;
        case 'llm-base-url':
        case 'llm-model':
          input.value = '';
          break;
        case 'llm-temperature': {
          input.value = defaults.llm && defaults.llm.temperature !== undefined ? defaults.llm.temperature : 0.7;
          const tv = document.getElementById('temp-val');
          if (tv) tv.textContent = input.value;
          break;
        }
        case 'llm-persona-prompt':
          input.value = charConfig.persona_prompt || '';
          break;
        case 'tts-engine-select':
          input.value = (defaults.tts && defaults.tts.provider) || 'fish_api_tts';
          toggleTtsPanel(input.value);
          break;
        case 'fish-model':
          input.value = (defaults.tts && defaults.tts.model) || 's2.1-pro-free';
          break;
        case 'fish-latency':
          input.value = (defaults.tts && defaults.tts.latency) || 'balanced';
          break;
        case 'fish-mode':
          input.value = (defaults.tts && defaults.tts.mode) || 'standard';
          break;
        case 'fish-format':
          input.value = (defaults.tts && defaults.tts.format) || 'wav';
          break;
        case 'fish-temperature':
          input.value = (defaults.tts && defaults.tts.temperature != null) ? defaults.tts.temperature : 0.7;
          {
            const l = document.getElementById('fish-temp-val');
            if (l) l.textContent = Number(input.value).toFixed(2);
          }
          break;
        case 'fish-top-p':
          input.value = (defaults.tts && defaults.tts.top_p != null) ? defaults.tts.top_p : 0.7;
          {
            const l = document.getElementById('fish-topp-val');
            if (l) l.textContent = Number(input.value).toFixed(2);
          }
          break;
        case 'fish-speed':
          input.value = (defaults.tts && defaults.tts.speed != null) ? defaults.tts.speed : 1.0;
          {
            const l = document.getElementById('fish-speed-val');
            if (l) l.textContent = `${Number(input.value).toFixed(2)}x`;
          }
          break;
        case 'fish-reference-id':
        case 'fish-base-url':
          input.value = '';
          break;
        case 'edge-voice':
          input.value = 'ja-JP-NanamiNeural';
          break;
        case 'mem-auto-generate':
          input.checked = true;
          break;
        case 'mem-update-interval':
        case 'mem-max-user-turns':
        case 'mem-target-tokens':
        case 'mem-recent-count':
        case 'mem-max-results':
        case 'mem-token-budget':
          input.value = '';
          break;
        case 'mem-retrieval-enabled':
          input.checked = true;
          break;
        case 'mem-retrieval-scope':
          input.value = 'current_conversation';
          break;
        case 'asr-mode':
          input.value = 'web_speech';
          break;
        case 'chk-auto-interrupt':
          input.checked = true;
          break;
        case 'vrm-lookat-mode':
          input.value = 'camera';
          break;
        case 'vrm-breath-scale': {
          input.value = 1.0;
          const bv = document.getElementById('breath-val');
          if (bv) bv.textContent = '1.0x';
          break;
        }
        case 'vrm-bg-select':
          input.value = 'default';
          break;
        default:
          input.value = '';
          break;
      }

      const origText = btn.innerHTML;
      btn.classList.add('reset-flash');
      btn.innerHTML = '✔ 已恢复';
      setTimeout(() => {
        btn.classList.remove('reset-flash');
        btn.innerHTML = origText;
      }, 900);
    });
  });
}

function bindStorageActions() {
  const btnMigrate = document.getElementById('btn-save-migrate-storage');
  if (btnMigrate && !btnMigrate.dataset.bound) {
    btnMigrate.dataset.bound = 'true';
    btnMigrate.addEventListener('click', async () => {
      const pathInput = document.getElementById('storage-path-input');
      const statusBox = document.getElementById('storage-op-status');
      const newPath = pathInput ? pathInput.value.trim() : '';
      if (!newPath) return;

      btnMigrate.disabled = true;
      btnMigrate.textContent = '正在迁移数据...';
      if (statusBox) {
        statusBox.className = 'storage-status-banner';
        statusBox.classList.remove('hidden', 'success', 'error');
        statusBox.textContent = `⏳ 正在迁移数据文件至 ${newPath}...`;
      }

      try {
        const res = await fetch('/api/settings/storage-path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ new_path: newPath, migrate: true }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          if (statusBox) {
            statusBox.classList.add('success');
            statusBox.innerHTML = `✅ ${data.message}`;
          }
          await loadSettingsFromServer();
          notifyMainViewport();
        } else if (statusBox) {
          statusBox.classList.add('error');
          statusBox.textContent = `❌ 迁移失败: ${data.detail || data.message || '未知错误'}`;
        }
      } catch (e) {
        if (statusBox) {
          statusBox.classList.add('error');
          statusBox.textContent = `❌ 请求错误: ${e.message}`;
        }
      } finally {
        btnMigrate.disabled = false;
        btnMigrate.textContent = '💾 保存并迁移数据';
      }
    });
  }

  const btnResetStorage = document.getElementById('btn-reset-storage-path');
  if (btnResetStorage && !btnResetStorage.dataset.bound) {
    btnResetStorage.dataset.bound = 'true';
    btnResetStorage.addEventListener('click', async () => {
      const statusBox = document.getElementById('storage-op-status');
      if (statusBox) {
        statusBox.className = 'storage-status-banner';
        statusBox.classList.remove('hidden', 'success', 'error');
        statusBox.textContent = '⏳ 正在重置并迁移数据回系统默认目录...';
      }
      try {
        const res = await fetch('/api/settings/storage-path/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const data = await res.json();
        if (res.ok && data.success) {
          if (statusBox) {
            statusBox.classList.add('success');
            statusBox.innerHTML = `✅ ${data.message}`;
          }
          await loadSettingsFromServer();
          notifyMainViewport();
        } else if (statusBox) {
          statusBox.classList.add('error');
          statusBox.textContent = `❌ 重置失败: ${data.detail || data.message || '未知错误'}`;
        }
      } catch (e) {
        if (statusBox) {
          statusBox.classList.add('error');
          statusBox.textContent = `❌ 请求错误: ${e.message}`;
        }
      }
    });
  }
}

function onProviderPresetChange(providerId) {
  const baseUrlInput = document.getElementById('llm-base-url');
  const modelInput = document.getElementById('llm-model');
  const presets = {
    deepseek: { url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    openrouter: { url: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat' },
    commandcode: { url: 'https://api.commandcode.ai/provider/v1', model: 'claude-3-5-sonnet-20241022' },
    opencode: { url: 'https://api.opencode.ai/v1', model: 'default' },
    custom: { url: 'https://api.your-service.com/v1', model: 'default' },
  };
  const p = presets[providerId];
  if (!p) return;
  if (baseUrlInput) {
    baseUrlInput.value = p.url;
    baseUrlInput.placeholder = p.url;
  }
  if (modelInput) {
    modelInput.value = p.model;
    modelInput.placeholder = p.model;
  }
  checkBaseUrlWarning(p.url);
}

function checkBaseUrlWarning(url) {
  const hintEl = document.getElementById('base-url-hint');
  if (!hintEl) return;
  if (url && (url.includes('/chat') || url.includes('/completions'))) {
    hintEl.style.color = '#f87171';
    hintEl.innerHTML =
      '⚠️ <strong>检测到路径包含 /chat</strong>：系统保存时将自动截断至 <code>/v1</code>，以统一当前 chat 模式并兼容未来 Agent response 扩展。';
  } else {
    hintEl.style.color = '#fbd38d';
    hintEl.innerHTML =
      '⚠️ 规范约束：端点请严格填至 <code>/v1</code> 结尾，请勿填写后面的 <code>/chat</code> 或 <code>/chat/completions</code>。当下默认 openai 兼容 chat 模式，同时预留未来 Agent response 扩展。';
  }
}

function validateAndCleanBaseUrl(url) {
  if (!url) return '';
  let clean = url.trim();
  if (clean.endsWith('/chat/completions')) clean = clean.substring(0, clean.length - '/chat/completions'.length);
  else if (clean.endsWith('/chat')) clean = clean.substring(0, clean.length - '/chat'.length);
  return clean.replace(/\/+$/, '');
}

function toggleTtsPanel(engine) {
  const fishPanel = document.getElementById('fish-audio-panel');
  const edgePanel = document.getElementById('edge-tts-panel');
  if (engine === 'fish_api_tts') {
    if (fishPanel) fishPanel.classList.remove('hidden');
    if (edgePanel) edgePanel.classList.add('hidden');
  } else {
    if (fishPanel) fishPanel.classList.add('hidden');
    if (edgePanel) edgePanel.classList.remove('hidden');
  }
}

function bindPasswordToggle(btnId, inputId) {
  const btn = document.getElementById(btnId);
  const input = document.getElementById(inputId);
  if (btn && input) {
    btn.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '👁️' : '🙈';
    });
  }
}

function renderVaultCards() {
  const container = document.getElementById('vault-cards-container');
  if (!container) return;
  container.innerHTML = '';

  const providers = [
    { id: 'deepseek', name: '官方 DeepSeek', defaultUrl: 'https://api.deepseek.com/v1' },
    { id: 'openrouter', name: 'OpenRouter', defaultUrl: 'https://openrouter.ai/api/v1' },
    { id: 'commandcode', name: 'Command Code', defaultUrl: 'https://api.commandcode.ai/provider/v1' },
    { id: 'opencode', name: 'OpenCode', defaultUrl: 'https://api.opencode.ai/v1' },
    { id: 'fish_audio', name: 'Fish Audio (TTS)', defaultUrl: 'https://api.fish.audio' },
    { id: 'custom', name: '自定义 Provider', defaultUrl: 'OpenAI-compatible' },
  ];

  providers.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'vault-card';
    const status =
      settingsData.keysStatus[p.id] || (p.id === 'fish_audio' ? settingsData.keysStatus['fish.audio'] : null);
    const isOk = status && status.configured;

    card.innerHTML = `
      <div class="vault-card-header">
        <span class="vault-card-title">${p.name}</span>
        <span class="vault-card-status ${isOk ? 'status-ok' : 'status-missing'}">
          ${isOk ? '● 已安全加密' : '○ 未配置'}
        </span>
      </div>
      <div class="vault-card-masked">
        ${isOk ? `密钥掩码: ${status.masked}` : 'DPAPI 保险库暂无此项密钥'}
      </div>
      <div style="display:flex;gap:6px;margin-top:4px;">
        <input type="password" id="vault-input-${p.id}" class="form-control" placeholder="输入新 Key..." style="padding:5px 8px;font-size:12px;">
        <button class="btn-secondary" style="padding:4px 10px;font-size:12px;" id="btn-save-key-${p.id}">保存</button>
      </div>
    `;
    container.appendChild(card);

    const btn = document.getElementById(`btn-save-key-${p.id}`);
    const inp = document.getElementById(`vault-input-${p.id}`);
    if (btn && inp) {
      btn.addEventListener('click', async () => {
        const val = inp.value.trim();
        if (!val) return;
        btn.textContent = '...';
        try {
          await fetch('/api/settings/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [p.id]: val }),
          });
          inp.value = '';
          btn.textContent = '✔';
          await loadSettingsFromServer();
        } catch (err) {
          btn.textContent = '✕';
        }
      });
    }
  });
}

// ---------------------------------------------------------------- 保存

async function saveAllSettings() {
  setStatus('正在保存配置并加密密钥...');

  const charSelect = document.getElementById('setting-char-select');
  const targetChar = (charSelect && charSelect.value) || targetCharacter || 'conf.yaml';
  targetCharacter = targetChar;

  // 后端 POST 必须带 character_file：全局页保存 LLM/记忆时它只是一个定位用的档案名，
  // 真正的 LLM 落盘位置是全局 conf.yaml（见后端实现）。
  const payload = { character_file: targetChar, scope: IS_GLOBAL ? 'global' : 'character' };

  if (IS_GLOBAL) {
    // ---------- 全局页：LLM + 语音合成 + 记忆 ----------
    const baseUrlInput = document.getElementById('llm-base-url');
    const modelInput = document.getElementById('llm-model');
    const tempInput = document.getElementById('llm-temperature');
    const cleanUrl = validateAndCleanBaseUrl(baseUrlInput ? baseUrlInput.value : '');
    if (baseUrlInput) baseUrlInput.value = cleanUrl;

    payload.llm = {
      provider: 'openai_compatible_llm',
      base_url: cleanUrl || undefined,
      model: (modelInput && modelInput.value.trim()) || undefined,
      temperature: tempInput ? parseFloat(tempInput.value) : undefined,
    };

    const memAuto = document.getElementById('mem-auto-generate');
    const intOrEmpty = (el) => (el && el.value.trim() ? parseInt(el.value.trim(), 10) : '');
    payload.memory = {
      auto_generate_enabled: memAuto ? memAuto.checked : true,
      update_interval_turns: intOrEmpty(document.getElementById('mem-update-interval')),
      maximum_source_user_turns: intOrEmpty(document.getElementById('mem-max-user-turns')),
      target_tokens: intOrEmpty(document.getElementById('mem-target-tokens')),
      retrieval_enabled: document.getElementById('mem-retrieval-enabled')
        ? document.getElementById('mem-retrieval-enabled').checked
        : true,
      retrieval_scope: document.getElementById('mem-retrieval-scope')
        ? document.getElementById('mem-retrieval-scope').value
        : 'current_conversation',
      retrieval_recent_count: intOrEmpty(document.getElementById('mem-recent-count')),
      retrieval_max_results: intOrEmpty(document.getElementById('mem-max-results')),
      retrieval_token_budget: intOrEmpty(document.getElementById('mem-token-budget')),
    };

    // 语音合成（全局）：引擎 + 全部合成参数 + 默认音色
    const ttsEngineSel = document.getElementById('tts-engine-select');
    const globalEngine = (ttsEngineSel && ttsEngineSel.value) || 'fish_api_tts';
    payload.tts = { provider: globalEngine };
    if (globalEngine === 'fish_api_tts') {
      const byId = (id) => document.getElementById(id);
      payload.tts.model = (byId('fish-model') && byId('fish-model').value) || 's2.1-pro-free';
      payload.tts.latency = (byId('fish-latency') && byId('fish-latency').value) || 'balanced';
      payload.tts.mode = (byId('fish-mode') && byId('fish-mode').value) || 'standard';
      payload.tts.format = (byId('fish-format') && byId('fish-format').value) || 'wav';
      payload.tts.base_url =
        (byId('fish-base-url') && byId('fish-base-url').value.trim()) || 'https://api.fish.audio';
      const tEl = byId('fish-temperature');
      if (tEl) payload.tts.temperature = parseFloat(tEl.value);
      const pEl = byId('fish-top-p');
      if (pEl) payload.tts.top_p = parseFloat(pEl.value);
      const sEl = byId('fish-speed');
      if (sEl) payload.tts.speed = parseFloat(sEl.value);
      // 这里的音色是"默认音色"（未单独绑定的角色使用）
      const rEl = byId('fish-reference-id');
      payload.tts.reference_id = (rEl && rEl.value.trim()) || undefined;
    }
  } else {
    // ---------- 角色页：人设 + 声音 ----------
    const personaInput = document.getElementById('llm-persona-prompt');
    payload.persona_prompt = personaInput ? personaInput.value : undefined;

    // 角色页只负责"音色"——引擎与合成参数在「全局设置 → 语音合成」里维护
    const gTtsCfg = (settingsData.config && settingsData.config.global_tts) || {};
    const roleEngine = gTtsCfg.tts_model || 'fish_api_tts';
    payload.tts = { provider: roleEngine };
    if (roleEngine === 'fish_api_tts') {
      const fishRefId = document.getElementById('fish-reference-id');
      payload.tts.reference_id = (fishRefId && fishRefId.value.trim()) || undefined;
    } else if (roleEngine === 'edge_tts') {
      const edgeVoice = document.getElementById('edge-voice');
      payload.tts.voice = edgeVoice ? edgeVoice.value : undefined;
    }
  }

  // 密钥（DPAPI 保险库）—— 全局页与角色页都可能填
  const keysToSave = {};
  const llmKeyInput = document.getElementById('llm-api-key');
  const providerPreset = document.getElementById('llm-provider-preset');
  const selectedProviderId = (providerPreset && providerPreset.value) || 'deepseek';
  if (llmKeyInput && llmKeyInput.value.trim()) keysToSave[selectedProviderId] = llmKeyInput.value.trim();
  const fishKeyInput = document.getElementById('fish-api-key');
  if (fishKeyInput && fishKeyInput.value.trim()) keysToSave['fish_audio'] = fishKeyInput.value.trim();

  if (Object.keys(keysToSave).length > 0) {
    try {
      await fetch('/api/settings/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(keysToSave),
      });
      if (llmKeyInput) llmKeyInput.value = '';
      if (fishKeyInput) fishKeyInput.value = '';
    } catch (e) {
      console.warn('Failed to save keys:', e);
    }
  }

  // 配置
  try {
    const res = await fetch('/api/settings/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setStatus(
        IS_GLOBAL
          ? '✅ 全局设置已保存（LLM / 记忆对所有角色生效）'
          : `✅ 角色设置已保存（人设与声音绑定到 ${targetChar.replace('.yaml', '')}）`
      );
      notifyMainViewport();
      setTimeout(() => window.close(), 900);
    } else {
      const err = await res.json();
      setStatus(`❌ 保存失败: ${err.detail || '未知错误'}`, true);
    }
  } catch (e) {
    setStatus(`❌ 保存失败: ${e.message}`, true);
  }
}

// ---------------------------------------------------------------- 初始化

function initSettingsWindow() {
  // Tab 切换
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const pane = document.getElementById(targetTab);
      if (pane) pane.classList.add('active');
    });
  });

  // 支持 ?tab=memory 之类直接定位（也兼容旧的 ?settings=memory）
  const params = new URLSearchParams(location.search);
  const wantTab = params.get('tab') || params.get('settings');
  if (wantTab) {
    const btn = document.querySelector(`[data-tab="tab-${wantTab}"]`);
    if (btn) btn.click();
  }

  const charSelect = document.getElementById('setting-char-select');
  if (charSelect) {
    charSelect.addEventListener('change', async (e) => {
      const f = e.target.value;
      if (!f) return;
      targetCharacter = f;
      const confRes = await fetch(`/api/settings/config?character=${encodeURIComponent(f)}`);
      if (confRes.ok) {
        settingsData.config = await confRes.json();
        renderSettingsUI(false);
      }
    });
  }

  const providerPreset = document.getElementById('llm-provider-preset');
  if (providerPreset) {
    providerPreset.addEventListener('change', (e) => onProviderPresetChange(e.target.value));
  }

  const baseUrlInput = document.getElementById('llm-base-url');
  if (baseUrlInput) {
    baseUrlInput.addEventListener('input', () => checkBaseUrlWarning(baseUrlInput.value));
    baseUrlInput.addEventListener('blur', () => {
      baseUrlInput.value = validateAndCleanBaseUrl(baseUrlInput.value);
      checkBaseUrlWarning(baseUrlInput.value);
    });
  }

  const tempInput = document.getElementById('llm-temperature');
  const tempVal = document.getElementById('temp-val');
  if (tempInput && tempVal) {
    tempInput.addEventListener('input', () => {
      tempVal.textContent = tempInput.value;
    });
  }

  // Fish 滑块：拖动时实时更新数值标签
  [
    ['fish-temperature', 'fish-temp-val', (v) => v.toFixed(2)],
    ['fish-top-p', 'fish-topp-val', (v) => v.toFixed(2)],
    ['fish-speed', 'fish-speed-val', (v) => `${v.toFixed(2)}x`],
  ].forEach(([id, labelId, fmt]) => {
    const el = document.getElementById(id);
    const label = document.getElementById(labelId);
    if (el && label) {
      el.addEventListener('input', () => {
        label.textContent = fmt(Number(el.value));
      });
    }
  });

  const breathInput = document.getElementById('vrm-breath-scale');
  const breathVal = document.getElementById('breath-val');
  if (breathInput && breathVal) {
    breathInput.addEventListener('input', () => {
      breathVal.textContent = `${breathInput.value}x`;
    });
  }

  const ttsEngineSelect = document.getElementById('tts-engine-select');
  if (ttsEngineSelect) {
    ttsEngineSelect.addEventListener('change', (e) => toggleTtsPanel(e.target.value));
  }

  bindPasswordToggle('btn-toggle-llm-key', 'llm-api-key');
  bindPasswordToggle('btn-toggle-fish-key', 'fish-api-key');
  bindStorageActions();
  bindFieldResetHandlers();

  // 全局设置存档（仅全局设置页有该容器；角色页调用会直接返回）
  loadProfiles();

  const btnSave = document.getElementById('btn-save-settings');
  if (btnSave) btnSave.addEventListener('click', saveAllSettings);

  const btnCancel = document.getElementById('btn-cancel-settings');
  if (btnCancel) btnCancel.addEventListener('click', () => window.close());

  const btnClose = document.getElementById('btn-close-settings');
  if (btnClose) btnClose.addEventListener('click', () => window.close());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.close();
  });

  if (window.opener) window.opener = null; // 独立窗口，不需要 opener 引用

  loadSettingsFromServer();
}

document.addEventListener('DOMContentLoaded', initSettingsWindow);


/* ============ 全局设置存档（3 个槽位）============
 * 每个槽位保存一整份**全局通用配置**快照：LLM + 长期记忆。
 * 不含 API 密钥（DPAPI 保险库独立管理）与数据存储路径（随机器走）。
 * 语义：抓的是"当前真实生效的配置"，而不是表单里未保存的草稿。
 */

function escapeHtmlAttr(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function shortHost(url) {
  try {
    return new URL(url).host;
  } catch (_) {
    return String(url || '').replace(/^https?:\/\//, '').split('/')[0];
  }
}

async function loadProfiles() {
  const grid = document.getElementById('profile-grid');
  if (!grid) return; // 角色设置页没有该容器
  try {
    const res = await fetch('/api/settings/profiles');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderProfileCards(grid, data);
  } catch (e) {
    grid.innerHTML = `<div class="pc-hint">存档加载失败：${escapeHtmlAttr(e.message)}</div>`;
  }
}

function renderProfileCards(grid, data) {
  const slots = data.slots || [];
  const active = typeof data.active === 'number' ? data.active : -1;
  const count = data.slotCount || 3;

  grid.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const s = slots[i] || {};
    const sum = s.summary || {};
    const saved = !!s.saved;
    const isActive = i === active;

    const card = document.createElement('div');
    card.className = `profile-card${isActive ? ' is-active' : ''}${saved ? '' : ' pc-empty'}`;
    card.dataset.index = String(i);
    card.innerHTML = `
      <div class="pc-top">
        <input class="pc-name" type="text" placeholder="存档 ${i + 1}"
               value="${escapeHtmlAttr(s.name || '')}" title="点此自定义存档名">
        ${isActive ? '<span class="pc-badge">使用中</span>' : ''}
      </div>
      <div class="pc-summary">
        ${
          saved
            ? `<div class="pc-line" title="${escapeHtmlAttr(sum.model || '')}">🤖 ${escapeHtmlAttr(sum.model || '(未设模型)')}</div>
               <div class="pc-line pc-dim" title="${escapeHtmlAttr(sum.baseUrl || '')}">🔗 ${escapeHtmlAttr(shortHost(sum.baseUrl) || '—')}</div>
               <div class="pc-line pc-dim">🧠 记忆: ${sum.memoryKeys ? sum.memoryKeys + ' 项自定义' : '默认'}</div>`
            : '<div class="pc-line pc-dim">尚未保存任何内容</div><div class="pc-line pc-dim">&nbsp;</div><div class="pc-line pc-dim">&nbsp;</div>'
        }
      </div>
      <div class="pc-actions">
        <button type="button" class="pc-capture" title="把当前生效的全局设置整体存入此槽位">存为快照</button>
        <button type="button" class="pc-apply" ${saved ? '' : 'disabled'}>启用</button>
        <button type="button" class="pc-clear" ${saved ? '' : 'disabled'}>清空</button>
      </div>
    `;

    card.querySelector('.pc-capture').addEventListener('click', () => captureProfile(i, card));
    card.querySelector('.pc-apply').addEventListener('click', () => applyProfile(i));
    card.querySelector('.pc-clear').addEventListener('click', () => clearProfile(i));
    card.querySelector('.pc-name').addEventListener('change', (e) => renameProfile(i, e.target.value));

    grid.appendChild(card);
  }
}

async function captureProfile(index, card) {
  const name = card.querySelector('.pc-name').value.trim();
  if (!confirm(`将把当前生效的全局设置（LLM + 长期记忆）整体存入「存档 ${index + 1}」，覆盖原有内容。继续？`)) return;
  try {
    const res = await fetch(`/api/settings/profiles/${index}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    await loadProfiles();
  } catch (e) {
    alert(`保存快照失败：${e.message}`);
  }
}

async function applyProfile(index) {
  if (!confirm(`启用「存档 ${index + 1}」会用它记录的全局设置覆盖当前生效配置。继续？`)) return;
  try {
    const res = await fetch(`/api/settings/profiles/${index}/apply`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    // conf.yaml / user_settings.json 已改写：刷新表单与卡片，并通知主视口重载
    await loadProfiles();
    await loadSettingsFromServer();
    notifyMainViewport();
  } catch (e) {
    alert(`启用存档失败：${e.message}`);
  }
}

async function clearProfile(index) {
  if (!confirm(`清空「存档 ${index + 1}」？当前生效的设置不受影响。`)) return;
  try {
    const res = await fetch(`/api/settings/profiles/${index}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    await loadProfiles();
  } catch (e) {
    alert(`清空存档失败：${e.message}`);
  }
}

async function renameProfile(index, newName) {
  const name = String(newName || '').trim();
  if (!name) return;
  try {
    await fetch(`/api/settings/profiles/${index}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  } catch (e) {
    console.warn('重命名存档失败:', e);
  }
}
