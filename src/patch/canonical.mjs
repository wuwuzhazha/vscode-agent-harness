const q = (value) => JSON.stringify(value);

export function permissionSpec(agent) {
  const options = agent.permissionMode.options;
  const values = options.map((option) => q(option.value)).join(",");
  const labels = options.map((option) => q(option.label)).join(",");
  const descriptions = options.map((option) => q(option.description)).join(",");
  return `{e:[${values}],l:[${labels}],d:[${descriptions}],def:${q(agent.permissionMode.default)}}`;
}

/** Ordered so the fallback agent (pi) is the final ternary branch. */
function permissionChain(agents) {
  if (agents.length === 0) throw new Error("no agents selected");
  // The fallback spec is the final ternary branch. Prefer the manifest that
  // marks itself as fallback; a partial install (e.g. zcode only) uses its
  // single agent so the chain still resolves for every provider id.
  const fallback =
    agents.find((agent) => agent.permissionMode.fallback) ?? agents[agents.length - 1];
  const named = agents
    .filter((agent) => agent !== fallback)
    .sort((a, b) => b.id.localeCompare(a.id));
  let chain = permissionSpec(fallback);
  for (const agent of named.reverse()) {
    chain = `id===${q(agent.id)}?${permissionSpec(agent)}:${chain}`;
  }
  return chain;
}

function autonomousExpression(agents) {
  const named = agents
    .filter((agent) => agent.permissionMode.autonomous !== "default")
    .sort((a, b) => b.id.localeCompare(a.id));
  let expr = q("default");
  for (const agent of named.reverse()) {
    expr = `id===${q(agent.id)}?${q(agent.permissionMode.autonomous)}:${expr}`;
  }
  return expr;
}

export function providerBlock(agents) {
  const entries = agents
    .map((agent) => `[${q(agent.id)},${q(agent.displayName)},${q(agent.description)}]`)
    .join(",");
  return (
    `(()=>{for(let[id,name,desc]of[${entries}]){` +
    "let p=f.createInstance(Wk);p.id=id;" +
    "let gd=p.getDescriptor.bind(p);p.getDescriptor=()=>{let d=gd();return{...d,provider:id,displayName:name,description:desc}};" +
    "let rc=p.resolveChatConfig.bind(p);" +
    `p.resolveChatConfig=async(e)=>{let c=await rc(e),pr=c?.schema?.properties?.permissionMode;let spec=${permissionChain(agents)};` +
    'if(pr){pr.enum=spec.e;pr.enumLabels=spec.l;pr.enumDescriptions=spec.d;pr.default=spec.def}' +
    "if(c?.values){let w=e?.config?.permissionMode;c.values.permissionMode=spec.e.includes(w)?w:spec.e.includes(c.values.permissionMode)?c.values.permissionMode:spec.def}" +
    "return c};" +
    `p.getAutonomousSessionConfig=()=>({permissionMode:${autonomousExpression(agents)}});` +
    "re.registerProvider(p)}})(),"
  );
}

export function vSFunction(agents) {
  const tail = agents.map((agent) => `r===${q(agent.id)}`).join("||");
  return `function vS(r){return r===ai||r===Ki||r===Ed||${tail}}`;
}

export function tombstoneCondition(agents) {
  return `r!==ai&&r!==Ki&&r!==Ed&&${agents
    .map((agent) => `r!==${q(agent.id)}`)
    .join("&&")}`;
}

export function schemeExpression(agents) {
  return `(r.session.scheme===Ed||${agents
    .map((agent) => `r.session.scheme===${q(agent.id)}`)
    .join("||")})`;
}

export function savedChatStore(agents) {
  const extra = agents
    .map((agent) => `[${q(agent.id)},e.createInstance(iE)]`)
    .join(",");
  return `new Map([[Ed,e.createInstance(iE)],[Ki,e.createInstance(oE)],${extra}])`;
}

export function storageAllowlist(agents) {
  const list = ["copilotcli", "claude", "codex", ...agents.map((agent) => agent.id)];
  return `[${list.map(q).join(",")}].includes`;
}

export function mIFunction(agents) {
  const base = ["default", "acceptEdits", "bypassPermissions", "plan", "auto"];
  const extra = new Set();
  for (const agent of agents) {
    for (const option of agent.permissionMode.options) extra.add(option.value);
  }
  const values = [...new Set([...base, ...extra])];
  return `function mI(r){switch(r){${values.map((value) => `case${q(value)}`).join(":")}:return r;default:return}}`;
}

/**
 * Only agents flagged `models.prefixInHost` get their ids prefixed here; others
 * (zcode) prefix ids in the shim catalog so the picker shows the real model id.
 */
export function modelIdReturn(agents) {
  const prefixed = agents.filter((agent) => agent.models?.prefixInHost && agent.models?.prefix);
  let idExpr = "r.value";
  let nameExpr = "r.displayName";
  for (const agent of prefixed) {
    const prefix = agent.models.prefix;
    const namePrefix = agent.displayName;
    idExpr = `i===${q(agent.id)}?(r.value.startsWith(${q(prefix)})?r.value:${q(prefix)}+r.value):${idExpr}`;
    nameExpr = `i===${q(agent.id)}?${q(`${namePrefix} · `)}+(r.displayName??r.value):${nameExpr}`;
  }
  return `return{provider:i,id:${idExpr},name:${nameExpr},supportsVision:!1,...t?{configSchema:t}:{}}`;
}

export const VFE_FUNCTION = "function VFe(r,i,g){return[...jFe(r,Wse,Bse),...jFe(i,Bse,g)]}";
export const JFE_FUNCTION = "function jFe(r,i,g){return r.map(e=>({...e,id:Lbt(i,e.id),_meta:{...e._meta,...J0(g??i)}}))}";
export const VFE_CALL = 'u=VFe(l,c,this.id==="claude"?void 0:this.id);';

export function wgeFunction(agents) {
  const head = agents
    .map((agent) => `if(o===${q(agent.id)})return${q(agent.displayName)};`)
    .join("");
  return `function Wge(s,o){${head}return o==="copilotcli"?d(18908,null):s.getVendors().find(t=>t.vendor===o)?.displayName??o.charAt(0).toUpperCase()+o.slice(1)}`;
}

export function gmtFunction(agents) {
  const condition = agents.map((agent) => `o===${q(agent.id)}`).join("||");
  return `function GMt(s,o){if(${condition})return{id:o};return s.getVendors().find(e=>e.vendor===o)?.icon}`;
}

export function oerFunction(agents) {
  const head = agents
    .map((agent) => `if(t===${q(`agent-host-${agent.id}`)})return{id:${q(agent.id)}};`)
    .join("");
  return `function oer(s){let t=s.metadata?.targetChatSessionType;${head}let o=TDs(s);return o.id===zUo.id?EDs:qu(o)}`;
}

export function sessionIconChain(agents) {
  const chain = agents.map((agent) => `e.provider===${q(agent.id)}?${q(`$(${agent.id})`)}`).join(":");
  return `icon:${chain}:void 0,when:`;
}

export function customModelFlags(agents) {
  const condition = agents
    .map((agent) => `e.provider===${q(agent.id)}`)
    .join("||");
  return `requiresCustomModels:!0,supportsAutoModel:(${condition})?!1:TKi(e.provider),`;
}

export function copilotSignIn(agents) {
  const condition = agents
    .map((agent) => `e.provider===${q(agent.id)}`)
    .join("||");
  return (
    `requiresCopilotSignIn:()=>{if(${condition})return!1;` +
    "let S=this._protectedResourcesService.getProtectedResources(e.provider);" +
    "return S!==void 0?PMt(S):!0}"
  );
}

export function cssRules(agents) {
  return agents
    .filter((agent) => agent.icon?.codicon && agent.icon?.svg)
    .map((agent) => {
      const name = agent.icon.codicon;
      const url = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E${agent.icon.svg}%3C/svg%3E")`;
      return (
        `/* ${agent.displayName} harness icon (SVG mask, font independent) */\n` +
        `.codicon-${name}:before {\n` +
        '  content: "";\n' +
        "  display: inline-block;\n" +
        "  width: 1em;\n" +
        "  height: 1em;\n" +
        "  background-color: currentColor;\n" +
        "  -webkit-mask-repeat: no-repeat;\n" +
        "  mask-repeat: no-repeat;\n" +
        "  -webkit-mask-position: center;\n" +
        "  mask-position: center;\n" +
        "  -webkit-mask-size: contain;\n" +
        "  mask-size: contain;\n" +
        "  vertical-align: -0.125em;\n" +
        `  -webkit-mask-image: ${url};\n` +
        `  mask-image: ${url};\n` +
        "}\n"
      );
    })
    .join("\n");
}
