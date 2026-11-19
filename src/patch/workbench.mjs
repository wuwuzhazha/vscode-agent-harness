import {
  copilotSignIn,
  customModelFlags,
  gmtFunction,
  oerFunction,
  sessionIconChain,
  wgeFunction,
} from "./canonical.mjs";
import { replaceMatch, runRules } from "./util.mjs";

function vendorLabelRule(agents) {
  const canonical = wgeFunction(agents);
  return {
    name: "vendor-label",
    apply(source) {
      if (source.includes(canonical)) return { source, matched: true, changed: false };
      return replaceMatch(source, /function Wge\(s,o\)\{[\s\S]*?\}function GMt\(s,o\)\{/, `${canonical}function GMt(s,o){`);
    },
  };
}

function vendorIconRule(agents) {
  const canonical = gmtFunction(agents);
  return {
    name: "vendor-icon",
    apply(source) {
      if (source.includes(canonical)) return { source, matched: true, changed: false };
      return replaceMatch(source, /function GMt\(s,o\)\{[\s\S]*?\}function /, `${canonical}function `);
    },
  };
}

function modelChipIconRule(agents) {
  const canonical = oerFunction(agents);
  return {
    name: "model-chip-icon",
    apply(source) {
      if (source.includes(canonical)) return { source, matched: true, changed: false };
      return replaceMatch(source, /function oer\(s\)\{[\s\S]*?\}var /, `${canonical}var `);
    },
  };
}

function sessionIconRule(agents) {
  const canonical = sessionIconChain(agents);
  return {
    name: "session-icon",
    apply(source) {
      if (source.includes(canonical)) return { source, matched: true, changed: false };
      if (source.includes('icon:e.provider==="pi"')) {
        return replaceMatch(source, /icon:e\.provider==="pi"\?[\s\S]*?:void 0,when:/, canonical);
      }
      // Pristine contribution has no icon field at all.
      return replaceMatch(source, /description:e\.description,when:/, `description:e.description,${canonical}`);
    },
  };
}

function customModelsRule(agents) {
  const canonical = customModelFlags(agents);
  return {
    name: "custom-model-flags",
    apply(source) {
      if (source.includes(canonical)) return { source, matched: true, changed: false };
      return replaceMatch(
        source,
        /requiresCustomModels:[^\n]*?supportsAutoModel:[^\n]*?TK[iI]\(e\.provider\),/,
        canonical
      );
    },
  };
}

function copilotSignInRule(agents) {
  const canonical = copilotSignIn(agents);
  return {
    name: "copilot-signin",
    apply(source) {
      if (source.includes(canonical)) return { source, matched: true, changed: false };
      return replaceMatch(
        source,
        /requiresCopilotSignIn:\(\)=>\{[\s\S]*?return [Ss]!==void 0\?PMt\([Ss]\):!0\}/,
        canonical
      );
    },
  };
}

export function patchWorkbench(source, agents) {
  const rules = [
    vendorLabelRule(agents),
    vendorIconRule(agents),
    modelChipIconRule(agents),
    sessionIconRule(agents),
    customModelsRule(agents),
    copilotSignInRule(agents),
  ];
  return runRules(source, rules, { agents });
}

export function verifyWorkbench(source, agents) {
  const required = [
    wgeFunction(agents),
    gmtFunction(agents),
    oerFunction(agents),
    sessionIconChain(agents),
    customModelFlags(agents),
    copilotSignIn(agents),
  ];
  return required.filter((piece) => !source.includes(piece));
}
