import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { conversationsService } from '../services/conversations.service';
import { requestHandler } from '../utils/requestHandler';
import { AppError, httpStatusOf } from '../utils/errors';
import * as path from 'path';
const fs = require('fs');
import { format } from 'date-fns';
import multer, { Multer } from "multer";
import FormData from "form-data";
import { MetadataConversationsModel } from '../models/MetadataConversationsModel';
import { ExperimentsModel } from '../models/ExperimentsModel';
import { authCookieOptions } from '../utils/cookieOptions';
import { withConversationLock } from '../utils/conversationLock';
import { clientMessageIdOf } from '../utils/clientMessageId';

const upload = multer({ storage: multer.memoryStorage() });

interface MulterRequest extends Request {
    file?: Multer.File;
}

// Access guard for every conversation route. admin: any. researcher: conversations of a study
// they own, or their own pilot run. participant: only their own.
// Older conversations lack `ownerId`, so it falls back to the experiment's owner.
async function verifyConversationOwnership(conversationId: string, userId: string, role: string): Promise<void> {
    if (role === 'admin') return;

    // Malformed id: 400, not a Mongo CastError 500.
    if (typeof conversationId !== 'string' || !mongoose.isValidObjectId(conversationId)) {
        throw new AppError('Invalid conversationId.', 400, 'INVALID_CONVERSATION_ID');
    }

    const metadata = await MetadataConversationsModel.findById(conversationId, {
        userId: 1,
        ownerId: 1,
        experimentId: 1,
    }).lean();

    if (role === 'participant') {
        if (!metadata || metadata.userId !== userId) {
            throw new AppError('This conversation belongs to another participant.', 403, 'CONVERSATION_NOT_OWNED');
        }
        return;
    }

    if (!metadata) {
        throw new AppError('This conversation belongs to someone else.', 403, 'CONVERSATION_NOT_OWNED');
    }

    // Own pilot run, even on someone else's study.
    if (metadata.userId === userId) return;

    const ownerId = metadata.ownerId ?? (await resolveExperimentOwnerId(metadata.experimentId));
    if (!ownerId || String(ownerId) !== String(userId)) {
        throw new AppError('This conversation belongs to another study.', 403, 'CONVERSATION_NOT_OWNED');
    }
}

// For conversations without `ownerId`. An ownerless experiment returns undefined, which denies.
async function resolveExperimentOwnerId(experimentId?: string): Promise<string | undefined> {
    if (!experimentId || !mongoose.isValidObjectId(experimentId)) return undefined;
    const experiment = await ExperimentsModel.findById(experimentId, { ownerId: 1 }).lean();
    return experiment?.ownerId ? String(experiment.ownerId) : undefined;
}

// Stricter than verifyConversationOwnership: preview routes need the caller's own run (or admin).
async function assertOwnsConversation(conversationId: string, userId: string, role: string): Promise<void> {
    const metadata = await MetadataConversationsModel.findById(conversationId, { userId: 1, ownerId: 1 }).lean();
    if (!metadata) throw new AppError('Conversation not found', 404, 'INVALID_CONVERSATION_ID');
    const isOwnRun = metadata.userId === userId;
    if (!isOwnRun && role !== 'admin') {
        throw new AppError('This conversation belongs to someone else.', 403, 'CONVERSATION_NOT_OWNED');
    }
}

// Builds the participant's turn server-side. Never forward the client's object: a forged
// `role: 'assistant'|'system'` would be stored and replayed to the model.
// Only `content` and a well-formed `clientMessageId` (for re-send dedup) cross over.
function toParticipantMessage<C extends string | Buffer>(sent: {
    content: C;
    clientMessageId?: unknown;
}): { role: 'user'; content: C; clientMessageId?: string } {
    const clientMessageId = clientMessageIdOf(sent.clientMessageId);
    return { role: 'user', content: sent.content, ...(clientMessageId !== undefined && { clientMessageId }) };
}

class ConversationsController {
    message = requestHandler(async (req: Request, res: Response) => {
        const { message: sent, conversationId }: { message: any; conversationId: string } = req.body;
        this.validateMessage(sent.content);
        await verifyConversationOwnership(conversationId, req.user._id, req.user.role);

        // One round at a time per conversation. Locked here because this route also serves group batch rounds.
        const savedResponse = await withConversationLock(conversationId, () =>
            conversationsService.message(toParticipantMessage(sent), conversationId, req.user._id, req.user.role),
        );
        res.status(200).send(savedResponse);
    });

    audio = [
        upload.single("audio"),
        requestHandler(async (req: MulterRequest, res: Response) => {
            const { conversationId } = req.body;
            const audioBlob = req.file?.buffer;

            if (!audioBlob) {
                return res.status(400).json({ message: "Audio file is missing", reason: 'INVALID_MESSAGE_FORMAT' });
            }

            await verifyConversationOwnership(conversationId, req.user._id, req.user.role);

            // Only the round is locked; the reply is written after release so a slow download doesn't block.
            const savedResponse = await withConversationLock(conversationId, () =>
                conversationsService.audio(
                    toParticipantMessage({ ...req.body, content: audioBlob }),
                    conversationId,
                    req.user._id,
                    req.user.role
                ),
            );

            console.log(savedResponse);

            const formData = new FormData();
            formData.append("metadata", JSON.stringify({
                _id: savedResponse._id,
                role: savedResponse.role,
                userAnnotation: savedResponse.userAnnotation,
                timeDelay: savedResponse.timeDelay,
                contentType: "audio/mpeg",
            }));

            formData.append("audio", savedResponse.content, {
                filename: "response_audio.mp3",
                contentType: "audio/mpeg",
            });

            res.setHeader("Content-Type", `multipart/form-data; boundary=${formData.getBoundary()}`);

            formData.pipe(res);
        }),
    ];


    // Webcam frame capture for offline facial analysis, gated by ENABLE_SNAPSHOTS.
    // Ids must be ObjectIds (hex only) because they are joined into a file path.
    sendSnap = requestHandler(async (req: Request, res: Response) => {
        const snapshotsEnabled = process.env.ENABLE_SNAPSHOTS === 'true';

        if (!snapshotsEnabled) {
            res.status(501).json({ message: 'Snapshot feature is not enabled' });
            return;
        }

        const { image, conversationId, experimentId } = (req.body ?? {}) as {
            image?: unknown;
            conversationId?: unknown;
            experimentId?: unknown;
        };

        if (typeof conversationId !== 'string' || !mongoose.Types.ObjectId.isValid(conversationId)) {
            throw new AppError('Invalid conversationId.', 400, 'INVALID_CONVERSATION_ID');
        }
        if (typeof experimentId !== 'string' || !mongoose.Types.ObjectId.isValid(experimentId)) {
            throw new AppError('Invalid experimentId.', 400, 'INVALID_EXPERIMENT_ID');
        }

        await verifyConversationOwnership(conversationId, req.user._id, req.user.role);

        const parts = typeof image === 'string' ? image.split(',') : [];
        if (parts.length < 2 || !parts[1]) {
            throw new AppError('Invalid base64 image data.', 400, 'INVALID_MESSAGE_FORMAT');
        }
        const buffer = Buffer.from(parts[1], 'base64');

        const folderPath = path.join('webcamBase', `${conversationId}_${experimentId}`);
        const formattedDateTime = format(new Date(), 'yyyyMMddHHmmss');

        await fs.promises.mkdir(folderPath, { recursive: true });
        await fs.promises.writeFile(path.join(folderPath, `${formattedDateTime}.png`), buffer);
        res.sendStatus(200);
    });

    streamMessage = requestHandler(
        async (req: Request, res: Response) => {
            // POST body is current; legacy GET query is still routed. The body keeps participant
            // text out of access logs and under the 8k URL limit (encoded Hebrew is ~6x).
            const body = (req.body ?? {}) as { message?: any; conversationId?: string };
            const conversationId = (body.conversationId ?? req.query.conversationId) as string;
            // GET's `role` is ignored; only POST carries a clientMessageId.
            const sent = body.message ?? { content: req.query.content as string };
            this.validateMessage(sent?.content);
            const message = toParticipantMessage(sent);
            await verifyConversationOwnership(conversationId, req.user._id, req.user.role);

            // Group uses its own NDJSON route. Otherwise it would open an empty SSE ending in an unreadable array.
            if (await conversationsService.isConversationGroup(conversationId)) {
                throw new AppError('Group conversations do not support token streaming', 400, 'GROUP_CONVERSATION');
            }

            // Lock before writing any response byte, so a refusal before the round starts is still plain JSON.
            await withConversationLock(conversationId, async () => {
                // Humanized agents need the full reply to pace it, so return paced Message[] as JSON, no SSE.
                if (await conversationsService.isConversationHumanized(conversationId)) {
                    const saved = await conversationsService.message(message, conversationId, req.user._id, req.user.role);
                    res.status(200).send(saved);
                    return;
                }

                // A split reply needs the whole text before cutting, so it is buffered too. After the HD
                // gate so HD+split keeps HD's pacing. X-Lexi-Reveal tells the client to typewriter it,
                // which it cannot infer from the payload (must be in corsOptions.exposedHeaders).
                if (await conversationsService.isConversationSplit(conversationId)) {
                    const saved = await conversationsService.message(
                        message,
                        conversationId,
                        req.user._id,
                        req.user.role,
                        undefined,
                        true,
                    );
                    res.setHeader('X-Lexi-Reveal', 'typewriter');
                    res.status(200).send(saved);
                    return;
                }

                // X-Accel-Buffering: no stops nginx buffering the stream.
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'X-Accel-Buffering': 'no',
                    Connection: 'keep-alive',
                });
                res.flushHeaders();

                const streamResponse = async (partialMessage) => {
                    res.write(`data: ${JSON.stringify({ message: partialMessage })}\n\n`);
                };

                const closeStream = async (message) => {
                    res.write(`event: close\ndata: ${JSON.stringify(message)}\n\n`);
                    res.end();
                };

                // No abort on client disconnect (here or group routes): finishing and saving beats a
                // half-saved round. PROVIDER_TIMEOUT_MS still releases the lock if a provider hangs.
                const savedResponse = await conversationsService.message(message, conversationId, req.user._id, req.user.role, streamResponse);
                closeStream(savedResponse);
            });
        },
        (req, res, error) => {
            // httpStatusOf, not error.code: Mongo codes like 11000 are not HTTP statuses.
            const status = httpStatusOf(error);
            const message = error?.message || 'Unexpected server error';
            const reason = error?.reason || 'UNEXPECTED';

            if (!res.headersSent) {
                res.status(status).json({ message, reason });
                return;
            }

            try {
                res.write(
                    `data: ${JSON.stringify({
                        error: { response: { status, data: { message, reason } } },
                    })}\n\n`,
                );
            } catch {}
            try { res.end(); } catch {}
        },
    );

    // Group stream token delta (`type: 'delta'`). Finished turns are bare Message lines with no `type`.
    private writeDeltaFrame =
        (res: Response) =>
        async (
            meta: { turnId: string; speakerId: string; speakerName: string; interSegmentPauseMs?: number },
            chunk: string,
        ) => {
            res.write(JSON.stringify({ type: 'delta', ...meta, text: chunk }) + '\n');
        };

    // Group streaming: one agent turn per NDJSON line, flushed as produced.
    streamGroupMessage = requestHandler(
        async (req: Request, res: Response) => {
            const { message: sent, conversationId, stream }: { message: any; conversationId: string; stream?: boolean } =
                req.body;
            this.validateMessage(sent.content);
            const message = toParticipantMessage(sent);
            await verifyConversationOwnership(conversationId, req.user._id, req.user.role);

            // Headers are written inside the lock, and only once the service accepts the round, so
            // refusals (duplicate id, closed block, cap) go out as plain JSON with their real status.
            await withConversationLock(conversationId, async () => {
                await conversationsService.groupMessageStream(
                    message,
                    conversationId,
                    req.user._id,
                    req.user.role,
                    async (savedTurn) => {
                        res.write(JSON.stringify(savedTurn) + '\n');
                    },
                    !!stream,
                    this.writeDeltaFrame(res),
                    () => {
                        // X-Accel-Buffering: no stops nginx buffering the stream.
                        res.writeHead(200, {
                            'Content-Type': 'application/x-ndjson',
                            'Cache-Control': 'no-cache',
                            'X-Accel-Buffering': 'no',
                            Connection: 'keep-alive',
                        });
                        res.flushHeaders();
                    },
                );
                res.end();
            });
        },
        (req, res, error) => {
            const status = httpStatusOf(error);
            const message = error?.message || 'Unexpected server error';
            const reason = error?.reason || 'UNEXPECTED';

            if (!res.headersSent) {
                res.status(status).json({ message, reason });
                return;
            }

            try {
                res.write(JSON.stringify({ error: { response: { status, data: { message, reason } } } }) + '\n');
            } catch {}
            try { res.end(); } catch {}
        },
    );

    // Group autonomous round: agents continue with no user message. Streams NDJSON like streamGroupMessage.
    streamAutonomousGroupRound = requestHandler(
        async (req: Request, res: Response) => {
            const { conversationId, stream }: { conversationId: string; stream?: boolean } = req.body;
            await verifyConversationOwnership(conversationId, req.user._id, req.user.role);

            // Metadata is read inside the lock so it reflects the round queued ahead of this one.
            // The stream opens only once the service accepts the round; refusals are plain JSON.
            await withConversationLock(conversationId, async () => {
                const metadataConversation = await conversationsService.getConversationMetadata(conversationId);

                await conversationsService.autonomousGroupRoundStream(
                    conversationId,
                    req.user._id,
                    req.user.role,
                    metadataConversation,
                    async (savedTurn) => {
                        res.write(JSON.stringify(savedTurn) + '\n');
                    },
                    !!stream,
                    this.writeDeltaFrame(res),
                    () => {
                        res.writeHead(200, {
                            'Content-Type': 'application/x-ndjson',
                            'Cache-Control': 'no-cache',
                            'X-Accel-Buffering': 'no',
                            Connection: 'keep-alive',
                        });
                        res.flushHeaders();
                    },
                );
                res.end();
            });
        },
        (req, res, error) => {
            const status = httpStatusOf(error);
            const message = error?.message || 'Unexpected server error';
            const reason = error?.reason || 'UNEXPECTED';

            if (!res.headersSent) {
                res.status(status).json({ message, reason });
                return;
            }

            try {
                res.write(JSON.stringify({ error: { response: { status, data: { message, reason } } } }) + '\n');
            } catch {}
            try { res.end(); } catch {}
        },
    );

    // Enter (or re-enter) a chat block of a survey-embedded study. Idempotent.
    // Public: the credential is the survey's participant id, since third-party cookies in the
    // iframe are blocked by Safari/Firefox. A logged-in researcher gets the preview path.
    enterSegment = requestHandler(async (req: Request, res: Response) => {
        const { experimentId, pid, segment } = { ...req.query, ...req.body } as any;

        if (!experimentId || typeof experimentId !== 'string') {
            throw new AppError('Missing experiment id', 400, 'INVALID_EXPERIMENT_ID');
        }

        const result = await conversationsService.enterSegment({
            experimentId,
            externalPid: typeof pid === 'string' ? pid : undefined,
            requestedSegment: segment != null ? Number(segment) : undefined,
            sessionUser: req.user ? { _id: req.user._id, role: req.user.role } : null,
        });

        // Cookie for browsers that keep it; the body token (sent back as Authorization) covers the rest.
        if (result.token) {
            res.cookie('token', result.token, authCookieOptions);
            res.cookie('conversationId', result.conversationId, authCookieOptions);
        }

        res.status(200).send({
            conversationId: result.conversationId,
            token: result.token,
            segment: result.segment,
            isPreview: result.isPreview,
            exhausted: result.exhausted,
            // Requested block not open yet (round in flight); the client retries the entry.
            ...(result.pendingSegment ? { pendingSegment: result.pendingSegment } : {}),
            // First touch before registration: no conversation exists yet.
            ...(result.needsRegistration ? { needsRegistration: true } : {}),
        });
    });

    // Survey answers from a break between chat blocks. Public, pid-authenticated (server-side
    // survey call). POST so answers stay out of the URL and browser history.
    postSurveyAnswers = requestHandler(async (req: Request, res: Response) => {
        const { experimentId, pid, gap, values, conversationId } = req.body || {};
        if (!experimentId || typeof experimentId !== 'string') {
            throw new AppError('Missing experiment id', 400, 'INVALID_EXPERIMENT_ID');
        }
        // conversationId form is the preview path; it bypasses pid, so it is privileged-only.
        if (conversationId) {
            if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'user')) {
                throw new AppError('Not permitted', 403, 'INSUFFICIENT_PERMISSIONS');
            }
            await assertOwnsConversation(String(conversationId), req.user._id, req.user.role);
        }
        const result = await conversationsService.recordSurveyAnswers({
            experimentId,
            externalPid: typeof pid === 'string' ? pid : undefined,
            conversationId: conversationId ? String(conversationId) : undefined,
            gap: Number(gap),
            values: values && typeof values === 'object' ? values : {},
        });
        res.status(200).send(result);
    });

    // Survey reports the chat is over; the only way to close the last block. Same credentials as postSurveyAnswers.
    finishSegments = requestHandler(async (req: Request, res: Response) => {
        const { experimentId, pid, conversationId } = req.body || {};
        if (!experimentId || typeof experimentId !== 'string') {
            throw new AppError('Missing experiment id', 400, 'INVALID_EXPERIMENT_ID');
        }
        if (conversationId) {
            if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'user')) {
                throw new AppError('Not permitted', 403, 'INSUFFICIENT_PERMISSIONS');
            }
            await assertOwnsConversation(String(conversationId), req.user._id, req.user.role);
        }
        const result = await conversationsService.finishSegments({
            experimentId,
            externalPid: typeof pid === 'string' ? pid : undefined,
            conversationId: conversationId ? String(conversationId) : undefined,
        });
        res.status(200).send(result);
    });

    // Researcher preview: close the current block without a survey.
    previewCloseSegment = requestHandler(async (req: Request, res: Response) => {
        const { conversationId } = req.body || {};
        if (!conversationId || typeof conversationId !== 'string') {
            throw new AppError('Missing conversation id', 400, 'INVALID_CONVERSATION_ID');
        }
        await assertOwnsConversation(conversationId, req.user._id, req.user.role);
        const segment = await conversationsService.previewCloseSegment(conversationId);
        res.status(200).send({ segment });
    });

    // Current block state, polled while a time quota is live. Evaluates the quota too, so a
    // minutes limit can close the block for a participant who stopped typing.
    getSegmentState = requestHandler(async (req: Request, res: Response) => {
        const { conversationId } = req.query as any;
        if (!conversationId || typeof conversationId !== 'string') {
            throw new AppError('Missing conversation id', 400, 'INVALID_CONVERSATION_ID');
        }
        await verifyConversationOwnership(conversationId, req.user._id, req.user.role);
        const segment = await conversationsService.readSegmentState(conversationId);
        res.status(200).send({ segment });
    });

    // The body's `numberOfConversations` is ignored: a client-supplied count would bypass
    // maxConversations. The service reads the stored count.
    createConversation = requestHandler(async (req: Request, res: Response) => {
        const { userId, experimentId } = req.body;

        // Only an admin may create a conversation for someone else; the service acts on the target user.
        if (req.user.role !== 'admin' && userId !== req.user._id) {
            throw new AppError(
                'You can only create conversations for yourself.',
                403,
                'CANNOT_CREATE_FOR_OTHER_USER',
            );
        }

        // Stops a participant JWT (SameSite=None cookie) being reused in another experiment's iframe.
        if (req.user.role === 'participant' && req.user.experimentId !== experimentId) {
            throw new AppError(
                'Participant does not belong to this experiment.',
                403,
                'EXPERIMENT_MISMATCH',
            );
        }

        const conversationId = await conversationsService.createConversation(userId, experimentId);
        res.cookie('conversationId', conversationId, authCookieOptions);
        res.status(200).send(conversationId);
    });

    getConversation = requestHandler(async (req: Request, res: Response) => {
        const conversationId = req.query.conversationId as string;

        if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
            res.status(400).json({ message: 'Invalid conversationId', reason: 'INVALID_MESSAGE_FORMAT' });
            console.warn(`Invalid conversationId: ${conversationId}`);
            return;
        }

        await verifyConversationOwnership(conversationId, req.user._id, req.user.role);

        const conversation = await conversationsService.getConversation(conversationId);
        // Projected: the raw doc holds the agent's system prompt and goes to the participant's browser.
        const conversationMetaData = await conversationsService.getClientConversationMetadata(conversationId);
        // Client-safe block state only, never the stored quota (a participant would start counting).
        // null when not segmented.
        const segment = await conversationsService.readSegmentState(conversationId);
        res.status(200).send({
            conversation,
            conversationMetaData: conversationMetaData ? { ...conversationMetaData, segment } : conversationMetaData,
        });
    });

    updateConversationMetadata = requestHandler(async (req: Request, res: Response) => {
        const { conversationId, data, isPreConversation } = req.body;
        await verifyConversationOwnership(conversationId, req.user._id, req.user.role);

        await conversationsService.updateConversationSurveysData(conversationId, data, isPreConversation);

        res.status(200).send();
    });

    // The body's `experimentId` is ignored; the service takes it from the verified conversation.
    finishConversation = requestHandler(async (req: Request, res: Response) => {
        const { conversationId } = req.body;
        await verifyConversationOwnership(conversationId, req.user._id, req.user.role);

        const isParticipant = req.user.role === 'participant';
        await conversationsService.finishConversation(conversationId, isParticipant);

        res.status(200).send();
    });

    updateUserAnnotation = requestHandler(async (req: Request, res: Response) => {
        const { messageId, userAnnotation } = req.body;
        // Plain id string only: an operator like `{$gte: ""}` would match someone else's message.
        if (typeof messageId !== 'string' || !mongoose.isValidObjectId(messageId)) {
            throw new AppError('Invalid messageId.', 400, 'INVALID_MESSAGE_FORMAT');
        }
        // Resolve the conversation from the message (not the body) and check ownership.
        const conversationId = await conversationsService.getMessageConversationId(messageId);
        if (!conversationId) {
            throw new AppError('Message not found.', 404, 'MESSAGE_NOT_FOUND');
        }
        await verifyConversationOwnership(conversationId, req.user._id, req.user.role);
        await conversationsService.updateUserAnnotation(messageId, conversationId, userAnnotation);

        res.status(200).send();
    });

    reportDisplayedAt = requestHandler(async (req: Request, res: Response) => {
        const { conversationId, displays } = req.body;
        // Plain id string only: `{$gte: "<own id>"}` would pass the ownership check and then widen
        // the update to later conversations.
        if (typeof conversationId !== 'string' || !mongoose.isValidObjectId(conversationId)) {
            throw new AppError('Invalid conversationId.', 400, 'INVALID_CONVERSATION_ID');
        }
        await verifyConversationOwnership(conversationId, req.user._id, req.user.role);
        await conversationsService.reportDisplayedAt(conversationId, displays);

        res.status(200).send();
    });

    private validateMessage(message: string): void {
        if (typeof message !== 'string') {
            throw new AppError('Message must be a non-empty string.', 400, 'INVALID_MESSAGE_FORMAT');
        }

        const tokenLimit = 4096;
        const estimatedTokens = this.estimateTokenCount(message);

        if (estimatedTokens > tokenLimit) {
            throw new AppError('Message is too long (max 4096 tokens).', 400, 'MESSAGE_TOO_LONG');
        }
    }

    private estimateTokenCount(message: string): number {
        const charsPerToken = 4;
        return Math.ceil(message.length / charsPerToken);
    }
}

export const conversationsController = new ConversationsController();
