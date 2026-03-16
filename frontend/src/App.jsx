import { useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import logoPrefSaude from './assets/logo-pref-saude.png'

const RAW_API_BASE = String(import.meta.env.VITE_API_BASE || '').trim()
const IS_PUBLIC_HOST = typeof window !== 'undefined' && !['localhost', '127.0.0.1'].includes(window.location.hostname)
const HAS_LOOPBACK_BASE = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/i.test(RAW_API_BASE)
const API_BASE = IS_PUBLIC_HOST && HAS_LOOPBACK_BASE ? '' : RAW_API_BASE
const TOKEN_KEY = 'lotacoes_token'
const REQUEST_ROUTE = '/solicitar'

function runBrowserDiagnostics() {
  if (!import.meta.env.DEV) return

  const healthUrl = `${API_BASE}/api/health`

  const info = {
    origin: window.location.origin,
    pathname: window.location.pathname,
    apiBase: API_BASE || '(same-origin)',
    healthUrl,
    timestamp: new Date().toISOString(),
  }

  console.groupCollapsed('[Lotacoes] Diagnostico de inicializacao')
  console.log('Contexto:', info)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  fetch(healthUrl, {
    method: 'GET',
    cache: 'no-store',
    signal: controller.signal,
  })
    .then(async (res) => {
      await res.text()
      console.log('Health status:', res.status)
      if (!res.ok) {
        console.error('API indisponivel. Verifique deploy, porta e roteamento do backend.')
      }
    })
    .catch((err) => {
      console.error('Falha ao consultar /api/health:', err)
      console.info('Possiveis causas: backend fora do ar, proxy sem rota para /api, ou erro 503 da plataforma.')
    })
    .finally(() => {
      clearTimeout(timeout)
      console.groupEnd()
    })
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function apiFetchJson(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()

  let body = {}
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      throw new Error('Resposta invalida da API. Verifique VITE_API_BASE no frontend e CORS_ORIGINS no backend.')
    }
  }

  if (!response.ok) {
    throw new Error(body.detail || 'Falha na requisição')
  }

  return body
}

function downloadBlob(blob, filename) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

function LoginIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 2a5 5 0 0 0-5 5v2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 7V7a3 3 0 1 1 6 0v2H9Zm3 3a2 2 0 0 1 1 3.732V17a1 1 0 1 1-2 0v-1.268A2 2 0 0 1 12 12Z"
      />
    </svg>
  )
}

function statusLabel(status) {
  const labels = {
    lotado_automatico: 'Lotado automático',
    desempate_manual: 'Desempate manual',
    nao_lotado: 'Não lotado',
    pendente: 'Pendente',
  }
  return labels[status] || status || '-'
}

export default function App() {
  const [route, setRoute] = useState(window.location.pathname || '/')
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || '')
  const [user, setUser] = useState(null)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  const [cpf, setCpf] = useState('')
  const [matricula, setMatricula] = useState('')
  const [servidor, setServidor] = useState(null)
  const [units, setUnits] = useState([])
  const [u1, setU1] = useState('')
  const [u2, setU2] = useState('')
  const [u3, setU3] = useState('')
  const [endereco, setEndereco] = useState('')
  const [comprovanteEndereco, setComprovanteEndereco] = useState(null)
  const [identidadeFile, setIdentidadeFile] = useState(null)
  const [step, setStep] = useState('identificacao')
  const [lastSubmission, setLastSubmission] = useState(null)
  const [quadroRows, setQuadroRows] = useState([])
  const [quadroVisible, setQuadroVisible] = useState(false)
  const [quadroLoading, setQuadroLoading] = useState(false)

  const [rows, setRows] = useState([])
  const [selectedRequestIds, setSelectedRequestIds] = useState([])
  const [meta, setMeta] = useState(null)
  const [q, setQ] = useState('')
  const [cargoFilter, setCargoFilter] = useState('')
  const [unitFilter, setUnitFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const canViewData = user?.role === 'admin' || user?.role === 'gestao'
  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    const onPopState = () => setRoute(window.location.pathname || '/')
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    runBrowserDiagnostics()
  }, [])

  useEffect(() => {
    if (!token) {
      setUser(null)
      return
    }

    apiFetchJson(`${API_BASE}/api/auth/me`, { headers: authHeaders(token) })
      .then((body) => setUser(body.user))
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY)
        setToken('')
        setUser(null)
      })
  }, [token])

  useEffect(() => {
    if (!canViewData || !token) return
    loadProtectedData()
  }, [canViewData, token])

  const unitOptions = useMemo(() => units.map((item) => item.unidade), [units])
  const panelCargoOptions = meta?.filtros?.cargos || []
  const panelUnitOptions = meta?.filtros?.unidades || []
  const panelStatusOptions = meta?.filtros?.status || []

  function navigate(pathname) {
    if (pathname === route) return
    window.history.pushState({}, '', pathname)
    setRoute(pathname)
  }

  async function loadProtectedData() {
    await Promise.all([fetchRequests(), fetchMeta()])
  }

  async function fetchMeta() {
    const body = await apiFetchJson(`${API_BASE}/api/meta`, { headers: authHeaders(token) })
    setMeta(body)
  }

  async function fetchRequests() {
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    if (cargoFilter.trim()) params.set('cargo', cargoFilter.trim())
    if (unitFilter.trim()) params.set('unidade', unitFilter.trim())
    if (statusFilter.trim()) params.set('status', statusFilter.trim())

    const body = await apiFetchJson(`${API_BASE}/api/requests?${params.toString()}`, {
      headers: authHeaders(token),
    })
    const nextRows = body.rows || []
    setRows(nextRows)
    setSelectedRequestIds((previous) => {
      const visibleIds = new Set(nextRows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id)))
      return previous.filter((id) => visibleIds.has(id))
    })
  }

  function handleToggleSelectRequest(id) {
    const numericId = Number(id)
    if (!Number.isInteger(numericId)) return
    setSelectedRequestIds((previous) =>
      previous.includes(numericId)
        ? previous.filter((item) => item !== numericId)
        : [...previous, numericId]
    )
  }

  function handleToggleSelectAllVisible() {
    const visibleIds = rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id))
    if (!visibleIds.length) return

    setSelectedRequestIds((previous) => {
      const allSelected = visibleIds.every((id) => previous.includes(id))
      if (allSelected) {
        return previous.filter((id) => !visibleIds.includes(id))
      }
      const merged = new Set([...previous, ...visibleIds])
      return [...merged]
    })
  }

  async function handleLogin(event) {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const body = await apiFetchJson(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword }),
      })

      localStorage.setItem(TOKEN_KEY, body.token)
      setToken(body.token)
      setUser(body.user)
      setLoginPassword('')
      navigate('/painel')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY)
    setToken('')
    setUser(null)
    setRows([])
    setMeta(null)
    setSuccessMessage('Sessão encerrada com sucesso.')
  }

  async function handleLookup(event) {
    event.preventDefault()
    setError('')
    setSuccessMessage('')

    try {
      const body = await apiFetchJson(
        `${API_BASE}/api/form/lookup?cpf=${encodeURIComponent(cpf)}&matricula=${encodeURIComponent(matricula)}`
      )
      setServidor(body.servidor)
      setUnits(body.unidades_disponiveis || [])
      setU1('')
      setU2('')
      setU3('')
      setStep('lotacao')
    } catch (err) {
      setServidor(null)
      setUnits([])
      setStep('identificacao')
      setError(err.message)
    }
  }

  function handleAdvanceToSummary(event) {
    event.preventDefault()
    setError('')

    const selected = [u1, u2, u3].filter(Boolean)
    if (!u1) {
      setError('A primeira opção de unidade é obrigatória.')
      return
    }

    const unique = new Set(selected)
    if (unique.size !== selected.length) {
      setError('As opções de unidade não podem se repetir.')
      return
    }

    if (!endereco.trim()) {
      setError('Preencha o endereço.')
      return
    }

    if (!comprovanteEndereco || !identidadeFile) {
      setError('Anexe comprovante de endereço e documento de identidade.')
      return
    }

    setStep('resumo')
  }

  function handleSavePdfSummary() {
    if (!lastSubmission) return

    const { serverData, protocol, documentData } = lastSubmission

    const doc = new jsPDF()
    const lines = [
      'Resumo da Solicitação de Lotação',
      '',
      `Protocolo: ${protocol}`,
      `Nome: ${serverData.nome || ''}`,
      `CPF: ${documentData.cpf}`,
      `Matrícula: ${documentData.matricula}`,
      `Cargo: ${serverData.cargo || ''}`,
      `Lotação atual: ${serverData.lotacao || ''}`,
      `Vínculo: ${serverData.vinculo || ''}`,
      `Endereço: ${documentData.endereco || '-'}`,
      `Comprovante de endereço: ${documentData.comprovanteEnderecoNome || '-'}`,
      `Documento de identidade: ${documentData.identidadeNome || '-'}`,
      '',
      'Opções escolhidas:',
      `1ª opção: ${documentData.u1 || '-'}`,
      `2ª opção: ${documentData.u2 || '-'}`,
      `3ª opção: ${documentData.u3 || '-'}`,
      '',
      `Gerado em: ${new Date().toLocaleString('pt-BR')}`,
    ]

    let y = 18
    doc.setFont('times', 'normal')
    doc.setFontSize(13)

    for (const line of lines) {
      doc.text(line, 14, y)
      y += 8
    }

    const safeMatricula = String(documentData.matricula || 'sem-matricula').replace(/[^a-zA-Z0-9_-]/g, '_')
    doc.save(`resumo_lotacao_${safeMatricula}.pdf`)
  }

  async function handleSubmitForm(event) {
    if (event?.preventDefault) event.preventDefault()
    setError('')
    setSuccessMessage('')

    try {
      const formData = new FormData()
      formData.append('cpf', cpf)
      formData.append('matricula', matricula)
      formData.append('unidade_1', u1)
      formData.append('unidade_2', u2)
      formData.append('unidade_3', u3)
      formData.append('endereco', endereco)
      formData.append('comprovante_endereco', comprovanteEndereco)
      formData.append('identidade', identidadeFile)

      const body = await apiFetchJson(`${API_BASE}/api/form/submit`, {
        method: 'POST',
        body: formData,
      })

      setLastSubmission({
        protocol: body.id,
        serverData: servidor,
        documentData: {
          cpf,
          matricula,
          u1,
          u2,
          u3,
          endereco,
          comprovanteEnderecoNome: comprovanteEndereco?.name || '',
          identidadeNome: identidadeFile?.name || '',
        },
      })

      setSuccessMessage(`Solicitacao enviada com sucesso. Protocolo ${body.id}.`)
      setU1('')
      setU2('')
      setU3('')
      setEndereco('')
      setComprovanteEndereco(null)
      setIdentidadeFile(null)
      setCpf('')
      setMatricula('')
      setServidor(null)
      setUnits([])
      setStep('confirmado')
      if (canViewData) await fetchRequests()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleReloadReference() {
    setError('')
    setSuccessMessage('')
    setLoading(true)
    try {
      const body = await apiFetchJson(`${API_BASE}/api/admin/reload-reference`, {
        method: 'POST',
        headers: authHeaders(token),
      })
      setSuccessMessage(body.message)
      await loadProtectedData()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleClearRequests() {
    setError('')
    setSuccessMessage('')
    if (!window.confirm('Confirma limpar todas as entradas do formulário?')) return

    try {
      const body = await apiFetchJson(`${API_BASE}/api/requests`, {
        method: 'DELETE',
        headers: authHeaders(token),
      })
      setSelectedRequestIds([])
      setSuccessMessage(`Entradas removidas: ${body.total_removido}. Anexos removidos: ${body.anexos_removidos || 0}`)
      await loadProtectedData()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDeleteSelectedRequests() {
    setError('')
    setSuccessMessage('')

    if (!selectedRequestIds.length) {
      setError('Selecione ao menos uma entrada para excluir.')
      return
    }

    if (!window.confirm(`Confirma excluir ${selectedRequestIds.length} entrada(s) selecionada(s)?`)) return

    try {
      const body = await apiFetchJson(`${API_BASE}/api/requests/selected`, {
        method: 'DELETE',
        headers: {
          ...authHeaders(token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: selectedRequestIds }),
      })
      setSelectedRequestIds([])
      setSuccessMessage(`Entradas removidas: ${body.total_removido}. Anexos removidos: ${body.anexos_removidos || 0}`)
      await loadProtectedData()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleExportCsv() {
    setError('')
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (cargoFilter.trim()) params.set('cargo', cargoFilter.trim())
      if (unitFilter.trim()) params.set('unidade', unitFilter.trim())
      if (statusFilter.trim()) params.set('status', statusFilter.trim())

      const response = await fetch(`${API_BASE}/api/reports/requests.csv?${params.toString()}`, {
        headers: authHeaders(token),
      })
      if (!response.ok) {
        const text = await response.text()
        let body = {}
        try {
          body = JSON.parse(text)
        } catch {
          throw new Error('Falha ao exportar CSV')
        }
        throw new Error(body.detail || 'Falha ao exportar CSV')
      }

      const blob = await response.blob()
      downloadBlob(blob, 'solicitacoes.csv')
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleExportDocx() {
    setError('')
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (cargoFilter.trim()) params.set('cargo', cargoFilter.trim())
      if (unitFilter.trim()) params.set('unidade', unitFilter.trim())
      if (statusFilter.trim()) params.set('status', statusFilter.trim())

      const response = await fetch(`${API_BASE}/api/reports/requests.docx?${params.toString()}`, {
        headers: authHeaders(token),
      })
      if (!response.ok) {
        const text = await response.text()
        let body = {}
        try {
          body = JSON.parse(text)
        } catch {
          throw new Error('Falha ao exportar Word')
        }
        throw new Error(body.detail || 'Falha ao exportar Word')
      }

      const blob = await response.blob()
      downloadBlob(blob, 'solicitacoes.docx')
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleToggleQuadroVagas() {
    setError('')

    if (quadroVisible) {
      setQuadroVisible(false)
      return
    }

    if (quadroRows.length === 0) {
      setQuadroLoading(true)
      try {
        const body = await apiFetchJson(`${API_BASE}/api/public/quadro-vagas`)
        setQuadroRows(body.rows || [])
      } catch (err) {
        setError(err.message)
      } finally {
        setQuadroLoading(false)
      }
    }

    setQuadroVisible(true)
  }

  if (route === '/login') {
    return (
      <div className="login-page">
        <div className="login-card">
          <p className="login-kicker">Área interna</p>
          <h1>Entrar no painel</h1>
          <p>Use seu usuário e senha para acessar filtros, relatórios e dados protegidos.</p>

          <form onSubmit={handleLogin} className="login-form">
            <label>
              Usuário
              <input value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} />
            </label>
            <label>
              Senha
              <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} />
            </label>
            <button type="submit" disabled={loading}>Entrar</button>
          </form>

          <button type="button" className="ghost" onClick={() => navigate('/')}>Voltar ao formulário</button>
          {error && <p className="error">{error}</p>}

          <footer className="login-footer">
            <img src={logoPrefSaude} alt="Secretaria Municipal de Saúde de Palmas" className="logo-footer" />
          </footer>
        </div>
      </div>
    )
  }

  if (route === '/painel') {
    return (
      <div className="page">
        <header className="hero hero-compact">
          <div className="hero-brand">
            <img src={logoPrefSaude} alt="Secretaria Municipal de Saúde de Palmas" className="logo-main" />
          </div>
          <div className="hero-copy">
            <p className="kicker">Painel Administrativo</p>
            <h1>Painel de dados</h1>
            <p className="hero-sub">Área exclusiva para visualização, filtros e relatórios.</p>
          </div>
          <div className="hero-actions">
            <button type="button" className="secondary" onClick={() => navigate('/')}>Ir para início</button>
            {!user && <button type="button" onClick={() => navigate('/login')}>Entrar</button>}
            {user && (
              <>
                <span className="pill">Perfil: {user.role}</span>
                <button type="button" className="secondary" onClick={handleLogout}>Sair</button>
              </>
            )}
          </div>
        </header>

        {!canViewData && (
          <section className="panel">
            <h2>Acesso restrito</h2>
            <p>Faça login para acessar o painel de dados.</p>
            <button type="button" onClick={() => navigate('/login')}>Ir para /login</button>
          </section>
        )}

        {canViewData && (
          <section className="panel">
            <h2>Painel de gestão</h2>

            <div className="toolbar">
              {isAdmin && (
                <button type="button" onClick={handleReloadReference} disabled={loading}>
                  Recarregar tabelas de referência
                </button>
              )}
              <button type="button" className="secondary" onClick={handleExportCsv}>
                Exportar CSV
              </button>
              <button type="button" className="secondary" onClick={handleExportDocx}>
                Exportar Word
              </button>
              {isAdmin && (
                <button type="button" className="danger" onClick={handleClearRequests}>
                  Limpar entradas
                </button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  className="danger"
                  onClick={handleDeleteSelectedRequests}
                  disabled={!selectedRequestIds.length}
                >
                  Excluir selecionadas ({selectedRequestIds.length})
                </button>
              )}
            </div>

            {meta && (
              <div className="cards compact">
                <article><h3>Servidores</h3><p>{meta.servidores}</p></article>
                <article><h3>Vagas mapeadas</h3><p>{meta.vagas}</p></article>
                <article><h3>Solicitações</h3><p>{meta.solicitacoes}</p></article>
              </div>
            )}

            <div className="filters-grid top-gap">
              <label>
                Busca (nome, CPF, matrícula)
                <input value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
              <label>
                Cargo
                <select value={cargoFilter} onChange={(e) => setCargoFilter(e.target.value)}>
                  <option value="">Todos</option>
                  {panelCargoOptions.map((cargo) => (
                    <option key={cargo} value={cargo}>{cargo}</option>
                  ))}
                </select>
              </label>
              <label>
                Unidade
                <select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)}>
                  <option value="">Todas</option>
                  {panelUnitOptions.map((unit) => (
                    <option key={unit} value={unit}>{unit}</option>
                  ))}
                </select>
              </label>
              <label>
                Status da lotação
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">Todos</option>
                  {panelStatusOptions.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={fetchRequests}>Aplicar filtros</button>
            </div>

            <SimpleTable
              rows={rows}
              selectable={isAdmin}
              selectedIds={selectedRequestIds}
              onToggleRow={handleToggleSelectRequest}
              onToggleAll={handleToggleSelectAllVisible}
            />
          </section>
        )}

        <footer className="page-footer">
          <img src={logoPrefSaude} alt="Secretaria Municipal de Saúde de Palmas" className="logo-footer" />
          <p className="credits">Sistema de Lotação - Website Temporário. Desenvolvimento: Coordenadoria de Sistemas de Informação</p>
        </footer>

        {error && <p className="error">{error}</p>}
        {successMessage && <p className="ok">{successMessage}</p>}
      </div>
    )
  }

  if (route === '/') {
    return (
      <div className="page landing-page">
        <header className="hero">
          <div className="hero-brand">
            <img src={logoPrefSaude} alt="Secretaria Municipal de Saúde de Palmas" className="logo-main" />
          </div>

          <div className="hero-copy">
            <p className="kicker">Sistema de Lotações</p>
            <h1>Aviso importante antes da solicitação</h1>
            <p className="hero-sub">
              Antes de preencher o formulário, leia atentamente o edital. As regras, prazos e critérios oficiais
              da lotação estão definidos nele.
            </p>
          </div>

          <div className="hero-actions">
            {!user && (
              <button
                type="button"
                className="icon-login-button"
                onClick={() => navigate('/login')}
                title="Acesso interno"
                aria-label="Acesso interno"
              >
                <LoginIcon />
              </button>
            )}
            {user && (
              <>
                <span className="pill">Perfil: {user.role}</span>
                <button type="button" className="secondary" onClick={handleLogout}>Sair</button>
              </>
            )}
          </div>
        </header>

        <main className="main-content">
          <section className="panel intro-panel">
            <h2>Bem vindo ao sistema de solicitação de lotações, referente ao edital X.</h2>
            <p>
              Ao realizar a inscrição, o Servidor declara ciência do presente edital.
            </p>

            <div className="actions-inline">
              <button type="button" className="secondary" disabled title="Edital ainda não disponível">
                Ver edital (em breve)
              </button>
              <button type="button" className="secondary" onClick={handleToggleQuadroVagas}>
                {quadroVisible ? 'Ocultar quadro de vagas' : 'Quadro de vagas'}
              </button>
              <button type="button" onClick={() => navigate(REQUEST_ROUTE)}>
                Solicitar lotação
              </button>
            </div>

            {quadroLoading && <p className="hint top-gap">Carregando quadro de vagas...</p>}

            {quadroVisible && !quadroLoading && (
              <section className="quadro-panel">
                <h3>Quadro de vagas</h3>
                <p className="quadro-meta">Total de vagas mapeadas: {quadroRows.reduce((acc, row) => acc + Number(row.vagas || 0), 0)}</p>
                <PublicVagasTable rows={quadroRows} />
              </section>
            )}
          </section>
        </main>

        <footer className="page-footer">
          <img src={logoPrefSaude} alt="Secretaria Municipal de Saúde de Palmas" className="logo-footer" />
          <p className="credits">Sistema de Lotação - Website Temporário. Desenvolvimento: Coordenadoria de Sistemas de Informação</p>
        </footer>

        {error && <p className="error">{error}</p>}
        {successMessage && <p className="ok">{successMessage}</p>}
      </div>
    )
  }

  return (
    <div className="page">
      <header className="hero">
        <div className="hero-brand">
          <img src={logoPrefSaude} alt="Secretaria Municipal de Saúde de Palmas" className="logo-main" />
        </div>

        <div className="hero-copy">
          <p className="kicker">Sistema de Lotações</p>
          <h1>Formulário de Solicitação</h1>
          <p className="hero-sub">
            Informe CPF e matrícula para preenchimento automático. O acesso aos dados consolidados exige autenticação.
          </p>
        </div>

        <div className="hero-actions">
          {!user && (
            <button
              type="button"
              className="icon-login-button"
              onClick={() => navigate('/login')}
              title="Acesso interno"
              aria-label="Acesso interno"
            >
              <LoginIcon />
            </button>
          )}
          {user && (
            <>
              <span className="pill">Perfil: {user.role}</span>
              <button type="button" className="secondary" onClick={handleLogout}>Sair</button>
            </>
          )}
        </div>
      </header>

      <main className="main-content">
        <section className="panel form-panel">
          {route !== REQUEST_ROUTE && (
            <div className="hint full">Use a página inicial para começar uma nova solicitação.</div>
          )}
          {step === 'identificacao' && (
            <>
              <h2>Etapa 1: Identificação</h2>
              <form className="form-grid" onSubmit={handleLookup}>
                <label>
                  CPF
                  <input value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" />
                </label>
                <label>
                  Matrícula
                  <input value={matricula} onChange={(e) => setMatricula(e.target.value)} />
                </label>
                <button type="submit">Ir para escolha de lotação</button>
              </form>
            </>
          )}

          {step === 'lotacao' && servidor && (
            <form className="form-grid" onSubmit={handleAdvanceToSummary}>
              <h2 className="full">Etapa 2: Escolha de lotação</h2>
              <label>
                Nome
                <input value={servidor.nome || ''} readOnly />
              </label>
              <label>
                Cargo
                <input value={servidor.cargo || ''} readOnly />
              </label>
              <label>
                Lotação atual
                <input value={servidor.lotacao || ''} readOnly />
              </label>
              <label>
                Vínculo
                <input value={servidor.vinculo || ''} readOnly />
              </label>

              <label className="full">
                Endereço
                <textarea
                  value={endereco}
                  onChange={(e) => setEndereco(e.target.value)}
                  placeholder="Informe seu endereço completo"
                  rows={3}
                  required
                />
              </label>

              <label>
                Comprovante de endereço (PDF, PNG, JPG)
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={(e) => setComprovanteEndereco(e.target.files?.[0] || null)}
                  required
                />
              </label>

              <label>
                Documento de identidade (PDF, PNG, JPG)
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={(e) => setIdentidadeFile(e.target.files?.[0] || null)}
                  required
                />
              </label>

              <label>
                1ª opção de unidade
                <select value={u1} onChange={(e) => setU1(e.target.value)} required>
                  <option value="">Selecione</option>
                  {unitOptions.map((u) => (
                    <option key={`u1-${u}`} value={u}>{u}</option>
                  ))}
                </select>
              </label>
              <label>
                2ª opção de unidade
                <select value={u2} onChange={(e) => setU2(e.target.value)}>
                  <option value="">Selecione</option>
                  {unitOptions.filter((u) => u !== u1).map((u) => (
                    <option key={`u2-${u}`} value={u}>{u}</option>
                  ))}
                </select>
              </label>
              <label>
                3ª opção de unidade
                <select value={u3} onChange={(e) => setU3(e.target.value)}>
                  <option value="">Selecione</option>
                  {unitOptions.filter((u) => u !== u1 && u !== u2).map((u) => (
                    <option key={`u3-${u}`} value={u}>{u}</option>
                  ))}
                </select>
              </label>

              <div className="hint full">
                As opções exibidas já são filtradas conforme cargo e quadro de vagas.
              </div>
              <div className="actions-inline full">
                <button type="button" className="secondary" onClick={() => setStep('identificacao')}>
                  Voltar
                </button>
                <button type="submit">Finalizar escolhas</button>
              </div>
            </form>
          )}

          {step === 'resumo' && servidor && (
            <section className="summary-card">
              <h2>Etapa 3: Resumo da solicitação</h2>
              <p>Confira os dados antes do envio final.</p>

              <div className="summary-grid">
                <div><strong>Nome:</strong> {servidor.nome}</div>
                <div><strong>CPF:</strong> {cpf}</div>
                <div><strong>Matrícula:</strong> {matricula}</div>
                <div><strong>Cargo:</strong> {servidor.cargo}</div>
                <div><strong>Lotação atual:</strong> {servidor.lotacao || '-'}</div>
                <div><strong>Vínculo:</strong> {servidor.vinculo || '-'}</div>
                <div><strong>Endereço:</strong> {endereco || '-'}</div>
                <div><strong>Comprovante de endereço:</strong> {comprovanteEndereco?.name || '-'}</div>
                <div><strong>Documento de identidade:</strong> {identidadeFile?.name || '-'}</div>
                <div><strong>1ª opção:</strong> {u1 || '-'}</div>
                <div><strong>2ª opção:</strong> {u2 || '-'}</div>
                <div><strong>3ª opção:</strong> {u3 || '-'}</div>
              </div>

              <div className="actions-inline">
                <button type="button" className="secondary" onClick={() => setStep('lotacao')}>Editar escolhas</button>
                <button type="button" onClick={handleSubmitForm}>Confirmar envio</button>
              </div>
            </section>
          )}

          {step === 'confirmado' && lastSubmission && (
            <section className="summary-card confirmed">
              <h2>Solicitação confirmada</h2>
              <p>Seu protocolo é <strong>{lastSubmission.protocol}</strong>.</p>

              <div className="summary-grid">
                <div><strong>Nome:</strong> {lastSubmission.serverData?.nome || '-'}</div>
                <div><strong>CPF:</strong> {lastSubmission.documentData?.cpf || '-'}</div>
                <div><strong>Matrícula:</strong> {lastSubmission.documentData?.matricula || '-'}</div>
                <div><strong>Cargo:</strong> {lastSubmission.serverData?.cargo || '-'}</div>
                <div><strong>Lotação atual:</strong> {lastSubmission.serverData?.lotacao || '-'}</div>
                <div><strong>Vínculo:</strong> {lastSubmission.serverData?.vinculo || '-'}</div>
                <div><strong>Endereço:</strong> {lastSubmission.documentData?.endereco || '-'}</div>
                <div><strong>Comprovante de endereço:</strong> {lastSubmission.documentData?.comprovanteEnderecoNome || '-'}</div>
                <div><strong>Documento de identidade:</strong> {lastSubmission.documentData?.identidadeNome || '-'}</div>
                <div><strong>1ª opção:</strong> {lastSubmission.documentData?.u1 || '-'}</div>
                <div><strong>2ª opção:</strong> {lastSubmission.documentData?.u2 || '-'}</div>
                <div><strong>3ª opção:</strong> {lastSubmission.documentData?.u3 || '-'}</div>
              </div>

              <div className="actions-inline">
                <button type="button" className="secondary" onClick={handleSavePdfSummary}>Salvar PDF</button>
                <button type="button" onClick={() => setStep('identificacao')}>Nova solicitação</button>
              </div>
            </section>
          )}
        </section>
      </main>

      <footer className="page-footer">
        <img src={logoPrefSaude} alt="Secretaria Municipal de Saúde de Palmas" className="logo-footer" />
        <p className="credits">Sistema de Lotação - Website Temporário. Desenvolvimento: Coordenadoria de Sistemas de Informação</p>
      </footer>

      {error && <p className="error">{error}</p>}
      {successMessage && <p className="ok">{successMessage}</p>}
    </div>
  )
}

function SimpleTable({ rows, selectable = false, selectedIds = [], onToggleRow, onToggleAll }) {
  if (!rows?.length) {
    return <p className="empty">Sem registros.</p>
  }

  const headers = Object.keys(rows[0])
  const allVisibleSelected = rows.every((row) => selectedIds.includes(Number(row.id)))
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {selectable && (
              <th>
                <input
                  type="checkbox"
                  aria-label="Selecionar todas as entradas visíveis"
                  checked={allVisibleSelected}
                  onChange={onToggleAll}
                />
              </th>
            )}
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.resultado_status === 'desempate_manual' ? 'row-tie' : ''}>
              {selectable && (
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Selecionar entrada ${row.id}`}
                    checked={selectedIds.includes(Number(row.id))}
                    onChange={() => onToggleRow?.(row.id)}
                  />
                </td>
              )}
              {headers.map((h) => (
                <td key={`${row.id}-${h}`}>
                  {h === 'resultado_status' ? (
                    <span className={`status-chip ${row.resultado_status || 'na'}`}>
                      {statusLabel(row[h])}
                    </span>
                  ) : (
                    String(row[h] ?? '')
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PublicVagasTable({ rows }) {
  if (!rows?.length) {
    return <p className="empty">Nenhuma vaga mapeada no momento.</p>
  }

  return (
    <div className="table-wrap quadro-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Unidade</th>
            <th>Cargo</th>
            <th>Vagas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.unidade}-${row.cargo}-${index}`}>
              <td>{row.unidade}</td>
              <td>{row.cargo}</td>
              <td>{row.vagas}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
