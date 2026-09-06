#!/usr/bin/env node
import {openSync,closeSync,constants,fstatSync,readSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectDirectTransfer,importDirectTransfer,DIRECT_TRANSFER_MAX_BYTES} from '../lib/direct-transfer.mjs';

const args=process.argv.slice(2),command=args.shift()||'collect',options={};
try{
 while(args.length){const key=args.shift();if(!['--targets','--file','--data-dir'].includes(key)||!args.length||options[key])throw new Error('参数无效');options[key]=args.shift();}
 if(command==='collect'){
  if(options['--file']||options['--data-dir'])throw new Error('collect 只向 stdout 导出，不写本地文件');
  const batch=await collectDirectTransfer({...(options['--targets']?{targetIds:options['--targets'].split(',')}:{}),onDiagnostic:event=>process.stderr.write(event.targetId+': '+event.reason+'\n')});
  process.stdout.write(JSON.stringify(batch)+'\n');if(batch.targets.some(t=>t.status==='failed'))process.exitCode=2;
 }else if(command==='import'){
  if(options['--targets'])throw new Error('import 不接受 targets 参数');
  let input;
  if(options['--file']){
   const file=options['--file'];if(lstatSync(file).isSymbolicLink())throw new Error('拒绝符号链接输入');
   const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
   try{const size=fstatSync(fd).size;if(size>DIRECT_TRANSFER_MAX_BYTES||!fstatSync(fd).isFile())throw new Error('输入文件无效或过大');const buffer=Buffer.alloc(size+1);let offset=0,read;while((read=readSync(fd,buffer,offset,buffer.length-offset,null))>0){offset+=read;if(offset>size)throw new Error('读取期间文件发生变化');}input=buffer.subarray(0,offset);}finally{closeSync(fd);}
  }else{const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>DIRECT_TRANSFER_MAX_BYTES)throw new Error('stdin 超过 8MB');chunks.push(chunk);}input=Buffer.concat(chunks);}
  const dataDir=options['--data-dir']||fileURLToPath(new URL('../data',import.meta.url));
  process.stdout.write(JSON.stringify(importDirectTransfer(input,{dataDir:path.resolve(dataDir)}))+'\n');
 }else throw new Error('用法: direct-transfer.mjs collect [--targets id,id] | import [--file batch.json] [--data-dir DIR]');
}catch(error){process.stderr.write('direct-transfer: '+error.message+'\n');process.exitCode=1;}
