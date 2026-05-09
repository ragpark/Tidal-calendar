import 'dotenv/config';
import { buildApp } from './adapters/http.js';

const app = buildApp();
const port = Number(process.env.VOICE_PORT ?? 4010);
app.listen(port, () => console.log(`Voice backend on ${port}`));
