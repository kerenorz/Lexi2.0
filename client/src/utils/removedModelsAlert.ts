// Shows the removed-model alert once per login: login clears the flag, the dialog sets it.
// Separate from the dialog so the login form doesn't bundle admin code.
const SHOWN_KEY = 'lexi.removedModelsAlertShown';

export const resetRemovedModelsAlert = () => {
    try {
        sessionStorage.removeItem(SHOWN_KEY);
    } catch {
        // nothing to reset
    }
};

export const removedModelsAlertShown = (): boolean => {
    try {
        return sessionStorage.getItem(SHOWN_KEY) === '1';
    } catch {
        return false;
    }
};

export const markRemovedModelsAlertShown = () => {
    try {
        sessionStorage.setItem(SHOWN_KEY, '1');
    } catch {
        // shows again next load
    }
};
