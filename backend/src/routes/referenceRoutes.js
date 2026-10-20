import { Router } from 'express';
import * as controller from '../controllers/referenceController.js';

/** Reference data is public -- it contains no personal information. */
const router = Router();

router.get('/bootstrap',        controller.bootstrap);
router.get('/cities',           controller.cities);
router.get('/blood-groups',     controller.bloodGroups);
router.get('/blood-components', controller.bloodComponents);
router.get('/organ-types',      controller.organTypes);
router.get('/compatibility',    controller.compatibility);
router.get('/matching-config',  controller.matchingConfig);

export default router;
