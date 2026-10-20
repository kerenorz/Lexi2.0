import { Request, Response } from 'express';
import { apiKeyGrantsService } from '../services/apiKeyGrants.service';
import { apiKeysService } from '../services/apiKeys.service';
import { experimentsService } from '../services/experiments.service';
import { requestHandler } from '../utils/requestHandler';

class ApiKeysController {
    // Keys with their billing studies and grantees. Joined here: apiKeys.service importing
    // experiments.service would be a cycle.
    getKeys = requestHandler(async (req: Request, res: Response) => {
        const [keys, usage, grantees] = await Promise.all([
            apiKeysService.getUserKeys(req.user._id),
            experimentsService.apiKeyUsage(req.user._id),
            apiKeyGrantsService.granteesByKey(req.user._id),
        ]);
        res.status(200).json(
            keys.map((key) => ({
                ...key,
                usedByStudies: usage[key._id] ?? [],
                // Only on keys I own; a grantee must not see the owner's other grantees.
                grantedTo: key.granted ? [] : grantees[key._id] ?? [],
            })),
        );
    });

    createKey = requestHandler(async (req: Request, res: Response) => {
        const { provider, name, note, apiKey } = req.body;
        if (!provider || !name || !apiKey) {
            res.status(400).json({
                message: 'provider, name, and apiKey are required',
                reason: 'INVALID_MESSAGE_FORMAT',
            });
            return;
        }
        const created = await apiKeysService.createKey(req.user._id, { provider, name, note, apiKey });
        res.status(201).json(created);
    });

    // The provider's default billing key, unless a study overrides it.
    setDefault = requestHandler(async (req: Request, res: Response) => {
        const updated = await apiKeysService.setDefaultKey(req.params.id, req.user._id);
        res.status(200).json(updated);
    });

    /**
     * Studies billing to this key, including grantees' (shown before deleting). Unscoped on
     * purpose, so the ownership check is what stops enumerating others' study titles.
     */
    private studiesBillingTo = async (keyId: string, userId: string) => {
        if (!(await apiKeysService.ownsKey(keyId, userId))) return [];
        return experimentsService.experimentsUsingApiKey(keyId);
    };

    getKeyExperiments = requestHandler(async (req: Request, res: Response) => {
        res.status(200).json(await this.studiesBillingTo(req.params.id, req.user._id));
    });

    // In-use key: 409 with the studies unless ?force=true. Forced, the studies' overrides are
    // cleared, not left dangling to fall back silently to the default key.
    deleteKey = requestHandler(async (req: Request, res: Response) => {
        const keyId = req.params.id;
        const force = String(req.query.force) === 'true';
        const inUse = await this.studiesBillingTo(keyId, req.user._id);
        if (inUse.length && !force) {
            res.status(409).send(inUse);
            return;
        }
        // Also closes every grant on the key.
        await apiKeysService.deleteKey(keyId, req.user._id);
        if (inUse.length) await experimentsService.clearApiKeyOverride(keyId);
        res.status(200).json({ message: 'Key deleted' });
    });

    checkHasKeys = requestHandler(async (req: Request, res: Response) => {
        const hasKeys = await apiKeysService.hasAnyKey(req.user._id);
        res.status(200).json({ hasKeys });
    });

    // Grants are checked against the key's owner, not the caller's role: holding a grant never
    // lets you issue one.

    createGrant = requestHandler(async (req: Request, res: Response) => {
        const { granteeUserId, expiresAt } = req.body;
        const grant = await apiKeyGrantsService.createGrant(req.params.id, req.user._id, {
            granteeUserId,
            expiresAt,
        });
        res.status(201).json(grant);
    });

    getKeyGrants = requestHandler(async (req: Request, res: Response) => {
        res.status(200).json(await apiKeyGrantsService.grantsForKey(req.params.id, req.user._id));
    });

    // Optionally narrowed with ?granteeUserId=.
    getIssuedGrants = requestHandler(async (req: Request, res: Response) => {
        const granteeUserId = req.query.granteeUserId ? String(req.query.granteeUserId) : undefined;
        res.status(200).json(await apiKeyGrantsService.grantsIssuedBy(req.user._id, granteeUserId));
    });

    getMyGrants = requestHandler(async (req: Request, res: Response) => {
        res.status(200).json(await apiKeyGrantsService.grantsToUser(req.user._id));
    });

    revokeGrant = requestHandler(async (req: Request, res: Response) => {
        res.status(200).json(await apiKeyGrantsService.revokeGrant(req.params.grantId, req.user._id));
    });
}

export const apiKeysController = new ApiKeysController();
