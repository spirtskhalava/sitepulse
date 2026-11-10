import { createApp } from "./app";
import { createPool } from "./db";
import { migrate } from "./migrate";

const db = createPool();
const port = Number(process.env.PORT ?? 3001);

await migrate(db);
createApp(db).listen(port, () => console.log(`api on http://localhost:${port}`));
