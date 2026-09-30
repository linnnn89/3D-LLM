'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../vrm_frontend/app.js'), 'utf8');
function section(start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}

test('character menu follows server list and confirmation, and cannot switch while disconnected', () => {
  const context = vm.createContext({ console: { log() {} } });
  vm.runInContext(`
    const CHARACTER_META = {zh_yuigahama_yui_01:{},zh_kita_ikuyo_01:{}};
    const CHARACTER_ID_ALIASES = {};
    let confirmedCharacterId = null, currentAdapter = null;
    const messages = [], updates = [], applied = [];
    const WebSocket = {OPEN:1};
    let ws = {readyState:1,send:message=>messages.push(JSON.parse(message))};
    const configSelect = {options:[],set innerHTML(value){this.options=[];},appendChild(option){this.options.push(option);}};
    const document = {createElement:()=>({getAttribute:()=>null})};
    const window = {dispatchEvent:event=>updates.push(event.detail)};
    class CustomEvent { constructor(type,options){this.detail=options.detail;} }
    const publishDesktopChat = () => {};
    const applyCharacterUI = id => applied.push(id);
    ${section('function resolveCharacterId(', 'function updateMotionSelectForCharacter(')}
    ${section('function desktopCharacterSnapshot()', 'function initWebSocket()')}
    ${section('function handleServerMessage(data)', 'function sendTextMessage(text)')}
    handleServerMessage({type:'config-files',configs:[
      {filename:'zh_yuigahama_yui_01.yaml',name:'由比滨结衣'},
      {filename:'zh_kita_ikuyo_01.yaml',name:'喜多郁代'}]});
  `, context);
  const value = expression => JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context));
  assert.deepEqual(value('window.__petCharacters.snapshot()'), {
    options: [['zh_yuigahama_yui_01.yaml', '由比滨结衣'], ['zh_kita_ikuyo_01.yaml', '喜多郁代']],
    active: '', connected: true
  });
  vm.runInContext(`handleServerMessage({type:'set-model-and-conf',conf_uid:'zh_yuigahama_yui_01'});
    window.__petCharacters.switchTo('zh_kita_ikuyo_01.yaml');`, context);
  assert.deepEqual(value('messages'), [{type:'switch-config',file:'zh_kita_ikuyo_01.yaml'}]);
  assert.equal(value('window.__petCharacters.snapshot().active'), 'zh_yuigahama_yui_01.yaml');
  assert.deepEqual(value('applied'), ['zh_yuigahama_yui_01']);
  vm.runInContext(`handleServerMessage({type:'error',message:'switch failed'});`, context);
  assert.equal(value('window.__petCharacters.snapshot().active'), 'zh_yuigahama_yui_01.yaml');
  vm.runInContext(`handleServerMessage({type:'set-model-and-conf',conf_uid:'zh_kita_ikuyo_01'});
    window.__petCharacters.switchTo('zh_kita_ikuyo_01.yaml');
    window.__petCharacters.switchTo('missing.yaml');
    ws.readyState=3; publishDesktopCharacters();
    window.__petCharacters.switchTo('zh_yuigahama_yui_01.yaml');`, context);
  assert.deepEqual(value('updates.at(-1)'), {
    type:'avatar.characters', options:[['zh_yuigahama_yui_01.yaml','由比滨结衣'],['zh_kita_ikuyo_01.yaml','喜多郁代']],
    active:'zh_kita_ikuyo_01.yaml',connected:false
  });
  assert.equal(value('messages.length'), 1);
});
