/*
 * Página de entrada: autentica o utilizador e abre a página do seu perfil.
 */

// Já com sessão iniciada neste separador: vai diretamente para a página do perfil.
const sessaoExistente = lerSessao();
if (sessaoExistente?.token && PAGINA_DO_PERFIL[sessaoExistente.utilizador?.perfil]) {
  location.href = PAGINA_DO_PERFIL[sessaoExistente.utilizador.perfil];
}

document.querySelectorAll('[data-email]').forEach(botao => botao.addEventListener('click', () => {
  $('email').value = botao.dataset.email;
  $('password').value = '123456';
}));

$('formLogin').addEventListener('submit', async evento => {
  evento.preventDefault();
  $('msgErroLogin').textContent = '';
  try {
    const dados = await pedidoApi('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('email').value, password: $('password').value }) });
    const pagina = PAGINA_DO_PERFIL[dados.utilizador.perfil];
    if (!pagina) throw new Error('Perfil sem página associada.');
    guardarSessao(dados);
    location.href = pagina;
  } catch (erro) {
    $('msgErroLogin').textContent = erro.message;
  }
});
