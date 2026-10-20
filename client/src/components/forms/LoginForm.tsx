import { setActiveUser } from '@DAL/redux/reducers/activeUserReducer';
import { extractError } from '@DAL/extractError';
import { login } from '@DAL/server-requests/users';
import { Pages } from '@app/App';
import { Box, Container, Grid, TextField } from '@mui/material';
import { getFormErrorMessage } from '@utils/commonFunctions';
import { resetRemovedModelsAlert } from '@utils/removedModelsAlert';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { FormButton, NoteText } from './CommonFormStyles.s';

interface LoginFormProps {
    isAdminPage: boolean;
    experimentId: string;
}

export const LoginForm: React.FC<LoginFormProps> = ({ isAdminPage, experimentId }) => {
    const navigate = useNavigate();
    const dispatch = useDispatch();
    const [needsPassword, setNeedsPassword] = useState(false);
    const {
        register,
        handleSubmit,
        setError,
        formState: { errors },
    } = useForm();

    const onSubmit = async (data) => {
        try {
            const { token, user } = await login(data.username, data.password, experimentId);

            if ((user.role === 'admin' || user.role === 'user') && !token) {
                setNeedsPassword(true);
            } else if (user) {
                dispatch(setActiveUser(user));
                resetRemovedModelsAlert();
                navigate(isAdminPage ? Pages.ADMIN : Pages.EXPERIMENT.replace(':experimentId', experimentId));
            }
        } catch (error) {
            console.error(error);
            if (error.response && error.response.status === 401) {
                setError('username', {
                    type: 'manual',
                    message: `User name ${
                        needsPassword || isAdminPage ? 'or Password are' : 'is'
                    } Invalid, Try again or Sign Up`,
                });
            } else {
                const { message } = extractError(error, 'Something went wrong, please try again later');
                setError('username', { type: 'manual', message });
            }
        }
    };

    return (
        <Container component="main" maxWidth="xs">
            <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate padding={2}>
                <Grid container spacing={2}>
                    <Grid item xs={12}>
                        {!isAdminPage && <NoteText>Please use the same username you signed up with.</NoteText>}
                        <TextField
                            error={Boolean(errors.username)}
                            helperText={getFormErrorMessage(errors.username)}
                            required
                            fullWidth
                            size="small"
                            {...register('username', { required: 'Please fill out username' })}
                            label="User Name"
                            id="username"
                        />
                    </Grid>
                    <Grid item xs={12}>
                        {(isAdminPage || needsPassword) && (
                            <TextField
                                error={Boolean(errors.password)}
                                helperText={getFormErrorMessage(errors.password)}
                                required
                                fullWidth
                                {...register('password', { required: 'Password is required' })}
                                label="Password"
                                type="password"
                                id="password"
                                size="small"
                                autoComplete="current-password"
                            />
                        )}
                    </Grid>
                </Grid>
                <Box display="flex" justifyContent="center">
                    <FormButton type="submit">Login</FormButton>
                </Box>
            </Box>
        </Container>
    );
};
