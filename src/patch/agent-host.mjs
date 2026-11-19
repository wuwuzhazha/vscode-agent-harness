import {
  JFE_FUNCTION,
  VFE_CALL,
  VFE_FUNCTION,
  mIFunction,
  modelIdReturn,
  providerBlock,
  savedChatStore,
  schemeExpression,
  storageAllowlist,
  tombstoneCondition,
  vSFunction,
} from "./canonical.mjs";
import { replaceMatch, replaceVariant, runRules } from "./util.mjs";

const PROVIDER_START =
  /re\.registerProvider\(f\.createInstance\(Wk\)\),|\(\(\)=>\{let pi=f\.createInstance\(Wk\)|\(\(\)=>\{for\(let\[id,name,desc\]of\[/;

function providerRule(agents) {
  const canonical = providerBlock(agents);
  return {
    name: "provider-registration",
    apply(source) {
      if (source.includes(canonical)) return { source, matched: true, changed: false };
      const match = PROVIDER_START.exec(source);
      if (!match) return { source, matched: false, changed: false };
      if (match[0].startsWith("re.registerProvider")) {
        const end = match.index + match[0].length;
        const next = source.slice(0, match.index) + canonical + source.slice(end);
        return { source: next, matched: true, changed: true };
      }
      const end = source.indexOf("})(),", match.index);
      if (end < 0) return { source, matched: false, changed: false };
      const next = source.slice(0, match.index) + canonical + source.slice(end + 5);
      return { source: next, matched: true, changed: true };
    },
  };
}

function vSRule(agents) {
  const canonical = vSFunction(agents);
  return {
    name: "provider-predicate",
    apply(source) {
      if (source.includes(canonical)) return { source, matched: true, changed: false };
      return replaceMatch(source, /function vS\(r\)\{return [^{}]*\}/, canonical);
    },
  };
}

function tombstoneRule(agents) {
  const canonical = `function tpt(r,i){if(${tombstoneCondition(agents)})return;`;
  return {
    name: "session-tombstone",
    apply(source) {
      if (source.includes(canonical)) return { source, matched: true, changed: false };
      return replaceMatch(source, /function tpt\(r,i\)\{if\([^{}]*\)return;/, canonical);
    },
  };
}

function schemeRule(agents) {
  const canonical = schemeExpression(agents);
  return {
    name: "session-scheme",
    apply(source) {
      if (source.includes(canonical)) return { source, matched: true, changed: false };
      const anchor = "r.session.scheme===Ed";
      const index = source.indexOf(anchor);
      if (index < 0) return { source, matched: false, changed: false };
      const next = source.slice(0, index) + canonical + source.slice(index + anchor.length);
      return { source: next, matched: true, changed: true };
    },
  };
}

function savedChatRule(agents) {
  const canonical = savedChatStore(agents);
  return {
    name: "saved-chat-store",
    apply(source) {
      if (source.includes(canonical)) return { source, matched: true, changed: false };
      return replaceMatch(
        source,
        /new Map\(\[\[Ed,e\.createInstance\(iE\)\],\[Ki,e\.createInstance\(oE\)\](?:,[^\]]*\])*\]\)/,
        canonical
      );
    },
  };
}

function storageAllowlistRule(agents) {
  const canonical = storageAllowlist(agents);
  return {
    name: "storage-allowlist",
    apply(source) {
      const pattern = /\["copilotcli","claude","codex"(?:,"[^"\]]*")*\]\.includes/g;
      if (!pattern.test(source)) return { source, matched: false, changed: false };
      const next = source.replace(pattern, canonical);
      return { source: next, matched: true, changed: next !== source };
    },
  };
}

function permissionNormalizerRule(agents) {
  const canonical = mIFunction(agents);
  return {
    name: "permission-normalizer",
    apply(source) {
      if (source.includes(canonical)) return { source, matched: true, changed: false };
      return replaceMatch(source, /function mI\(r\)\{switch\(r\)\{[\s\S]*?default:return\}\}/, canonical);
    },
  };
}

function envTagRule() {
  return {
    name: "harness-env-tag",
    apply(source) {
      if (source.includes("PI_HARNESS:this.id")) return { source, matched: true, changed: false };
      const pattern = /t=QFe\(\),(?:\s*)n=await this\._sdkService\.query/;
      if (!pattern.test(source)) return { source, matched: false, changed: false };
      return {
        source: source.replace(pattern, "t=QFe();t.env={...(t.env||{}),PI_HARNESS:this.id};let n=await this._sdkService.query"),
        matched: true,
        changed: true,
      };
    },
  };
}

function modelIdRule(agents) {
  const canonical = modelIdReturn(agents);
  return {
    name: "model-ids",
    apply(source) {
      if (source.includes(canonical)) return { source, matched: true, changed: false };
      return replaceMatch(
        source,
        // 1.147.0 also has a pRt return object on the same minified line.
        // Match the exact fRt form so the rule cannot consume pRt and hRt.
        /return\{provider:i,id:r\.value,name:r\.displayName,supportsVision:!1,\.\.\.t\?\{configSchema:t\}:\{\}\}/,
        canonical
      );
    },
  };
}

function modelGroupRule() {
  return {
    name: "model-group-ids",
    apply(source) {
      let next = source;
      const vfe = replaceMatch(
        next,
        /function VFe\(r,i(?:,g)?\)\{return\[\.\.\.jFe\(r,Wse(?:,Bse)?\),\.\.\.jFe\(i,Bse(?:,[gi])?\)\]\}/,
        VFE_FUNCTION
      );
      next = vfe.source;
      const jfe = replaceMatch(
        next,
        /function jFe\(r,i(?:,g)?\)\{return r\.map\(e=>\(\{\.\.\.e,id:Lbt\(i,e\.id\),_meta:\{\.\.\.e\._meta,\.\.\.J0\([^)]*\)\}\}\)\)\}/,
        JFE_FUNCTION
      );
      next = jfe.source;
      const call = replaceVariant(next, VFE_CALL, ["u=VFe(l,c);", "u=VFe(l,c,this.id);"]);
      next = call.source;
      const matched = vfe.matched || jfe.matched || call.matched;
      return { source: next, matched, changed: next !== source };
    },
  };
}

export function patchAgentHost(source, agents) {
  const rules = [
    providerRule(agents),
    vSRule(agents),
    tombstoneRule(agents),
    schemeRule(agents),
    savedChatRule(agents),
    storageAllowlistRule(agents),
    permissionNormalizerRule(agents),
    envTagRule(),
    modelIdRule(agents),
    modelGroupRule(),
  ];
  return runRules(source, rules, { agents });
}

export function verifyAgentHost(source, agents) {
  const required = [
    providerBlock(agents),
    vSFunction(agents),
    tombstoneCondition(agents),
    savedChatStore(agents),
    storageAllowlist(agents),
    mIFunction(agents),
    "PI_HARNESS:this.id",
    modelIdReturn(agents),
    VFE_FUNCTION,
    JFE_FUNCTION,
    VFE_CALL,
  ];
  return required.filter((piece) => !source.includes(piece));
}
