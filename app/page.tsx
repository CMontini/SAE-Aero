import { requireChatGPTUser } from './chatgpt-auth';
import Workspace from './workspace';
export const dynamic = 'force-dynamic';
export default async function Home() {
    const u = await requireChatGPTUser('/');
    return <Workspace user={{ id: u.userId, name: u.displayName, email: u.email }}/>;
}
