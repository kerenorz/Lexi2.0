// Lists the sampling sliders the chosen model ignores, so they don't look effective.
// Renders nothing when the model honours them all.
import { getModelCatalogue } from '@DAL/server-requests/agents';
import { CatalogueModel } from '@models/AppModels';
import { Alert } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { ignoredSettingLabels, replacesMaxTokens } from './modelSettings';

export const ModelSettingsNotice: React.FC<{ model?: string }> = ({ model }) => {
    const [catalogue, setCatalogue] = useState<CatalogueModel[]>([]);

    useEffect(() => {
        let cancelled = false;
        getModelCatalogue()
            .then((models) => {
                if (!cancelled) setCatalogue(models);
            })
            // The model picker already reports the failure.
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);

    const entry = catalogue.filter((m) => m.id === model)[0];
    const ignored = ignoredSettingLabels(entry);
    if (ignored.length === 0) return null;

    return (
        <Alert severity="info" sx={{ mt: 2 }}>
            {`${model} does not use: ${ignored.join(', ')}. Those settings are not sent to it.`}
            {replacesMaxTokens(entry) && ' It reasons before it answers, so Lexi gives it a fixed budget instead of Max tokens.'}
        </Alert>
    );
};
