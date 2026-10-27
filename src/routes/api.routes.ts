import { Router } from 'express';
import { ApiController } from '../controllers/api.controller';
import { autenticarJWT, exigirPerfis } from '../middleware/auth.middleware';

export const router = Router();
router.post('/auth/login', ApiController.login);
router.get('/formularios/ativo', autenticarJWT, ApiController.obterFormularioAtivo);
router.get('/doentes', autenticarJWT, ApiController.listarDoentes);
router.get('/doentes/:idDoente/processo', autenticarJWT, ApiController.obterProcessoDoente);
router.post('/doentes/:idDoente/submissoes', autenticarJWT, ApiController.submeterMonitorizacao);
router.post('/doentes/:idDoente/kps', autenticarJWT, exigirPerfis('MEDICO'), ApiController.registarKps);
router.post('/doentes/:idDoente/planos', autenticarJWT, exigirPerfis('MEDICO'), ApiController.definirPlano);
router.post('/doentes/:idDoente/tratamentos', autenticarJWT, exigirPerfis('MEDICO'), ApiController.registarTratamento);
router.post('/doentes/:idDoente/decisoes', autenticarJWT, exigirPerfis('MEDICO'), ApiController.registarDecisao);
router.get('/alertas', autenticarJWT, exigirPerfis('ENFERMEIRO', 'MEDICO'), ApiController.listarAlertas);
router.put('/alertas/:idAlerta/triagem', autenticarJWT, exigirPerfis('ENFERMEIRO', 'MEDICO'), ApiController.triarAlerta);
router.get('/fhir/Patient/:idDoente/$everything', autenticarJWT, exigirPerfis('MEDICO', 'ENFERMEIRO'), ApiController.exportarFhir);