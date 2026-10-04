import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {captureCompleted,compactCompleted} from './completed-output.mjs';
export {parseGitStatus} from './completed-output.mjs';
export const gitOutputProfile='git-status-porcelain-v1-z';
// Closed profile: caller-supplied parser/select/executable/argv cannot replace it.
export const captureGitStatus=(options={})=>captureCompleted({...options,profile:gitOutputProfile});
export const compactCompletedGit=options=>compactCompleted({...options,profile:gitOutputProfile});
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const [command,dir,...args]=process.argv.slice(2);
    if(command!=='run'||!dir||args.length)throw Error('Usage: node integration/git-output.mjs run ARTIFACT_DIR');
    const capture=await captureGitStatus(),result=await compactCompletedGit({capture,artifactDir:dir});
    process.exitCode=capture.provenance.exit_code===0&&!capture.provenance.error&&!capture.provenance.cancelled&&!capture.provenance.timed_out?0:1;
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch(error){process.stderr.write(error.message+'\n');process.exitCode=2;}
}
