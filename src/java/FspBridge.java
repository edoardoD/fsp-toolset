import lts.*;
import java.io.*;
import java.util.*;
import java.lang.reflect.*;

/**
 * Headless bridge around the (GUI-only) LTSA engine.
 *
 * Usage: java -cp ltsa.jar:. FspBridge <mode> <file> [target]
 *   list      parse the file, report syntax errors and available targets
 *   graph     compile (and compose) one target, dump its LTS as JSON
 *   check     safety + deadlock check of one target (LTSA "Check > Safety")
 *   progress  progress check of one target (LTSA "Check > Progress")
 *
 * Only JSON is written to stdout; everything LTSA prints goes into the "log" field.
 */
public class FspBridge {
    private static final int MAX_TRANSITIONS = 200000;

    public static void main(String[] args) throws Exception {
        final PrintStream realOut = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
        // LTSA occasionally prints to System.out: keep stdout clean for JSON.
        System.setOut(System.err);

        if (args.length < 2) {
            System.err.println("Usage: FspBridge <list|graph|check|progress> <file.lts> [target]");
            System.exit(2);
        }
        String mode = args[0];
        String filePath = args[1];
        String target = args.length > 2 ? args[2] : null;

        String content;
        try {
            content = readFile(filePath);
        } catch (IOException e) {
            realOut.println("{\"errors\":[" + errorJson(1, 1, "Cannot read file: " + e.getMessage()) + "],\"targets\":[],\"machines\":[],\"log\":\"\"}");
            return;
        }

        File abs = new File(filePath).getAbsoluteFile();
        String dir = abs.getParent() != null ? abs.getParent() : ".";

        final StringBuilder log = new StringBuilder();
        LTSOutput output = new LTSOutput() {
            public void out(String s) { log.append(s); }
            public void outln(String s) { log.append(s).append('\n'); }
            public void clearOutput() { }
        };
        try {
            // lts.StateMachine is package-private: set its static log sink via reflection.
            java.lang.reflect.Field of = Class.forName("lts.StateMachine").getDeclaredField("output");
            of.setAccessible(true);
            of.set(null, output);
        } catch (Throwable ignored) { }
        Diagnostics.init(output);

        List<String> errors = new ArrayList<String>();
        List<String> targets = new ArrayList<String>();
        List<String> machines = new ArrayList<String>();
        List<String> trace = new ArrayList<String>();
        String verdict = "";

        // 1. Syntax pass (always): gives errors and the list of targets.
        Hashtable composites = new Hashtable();
        Hashtable processes = new Hashtable();
        boolean parsed = false;
        try {
            SymbolTable.init();
            new LTSCompiler(new LTSInputString(content), output, dir).parse(composites, processes);
            parsed = true;
        } catch (LTSException e) {
            errors.add(errorFromException(e, content));
        } catch (Throwable e) {
            errors.add(errorJson(1, 1, String.valueOf(e)));
        }
        if (parsed) {
            for (Object k : sorted(composites.keys())) targets.add(targetJson((String) k, "composite"));
            for (Object k : sorted(processes.keys())) targets.add(targetJson((String) k, "process"));
        }

        // 2. Mode specific work.
        if (parsed && !mode.equals("list")) {
            String name = target;
            if (name == null) {
                // Same default LTSA uses: first composite, otherwise "all processes".
                name = composites.size() > 0 ? (String) sorted(composites.keys()).get(0) : "DEFAULT";
            }
            try {
                // LTSA's compile() only knows composites (an unknown name silently falls back to the
                // first composite), so a plain process is wrapped in a synthetic composite appended at EOF.
                String source = content;
                boolean wrapped = false;
                if (composites.get(name) == null && processes.get(name) != null) {
                    source = content + "\n||FSPTARGET = (" + name + ").\n";
                    name = "FSPTARGET";
                    wrapped = true;
                }
                LTSCompiler compiler = new LTSCompiler(new LTSInputString(source), output, dir);
                CompositeState cs = compiler.compile(name);
                if (cs == null) {
                    errors.add(errorJson(1, 1, "Target not found: " + name));
                } else if (mode.equals("graph")) {
                    Map<String, Map<Integer, String>> allProcNames = new HashMap<String, Map<Integer, String>>();
                    for (Object pk : processes.keySet()) {
                        String pName = (String) pk;
                        allProcNames.put(pName, extractProcessStateNames(processes.get(pk), pName));
                    }
                    cs.compose(output);
                    List<CompactState> list = new ArrayList<CompactState>();
                    if (cs.composition != null) {
                        list.add(cs.composition);
                    } else if (cs.machines != null) {
                        for (Object o : cs.machines) {
                            if (o instanceof CompactState) list.add((CompactState) o);
                        }
                    }
                    for (CompactState m : list) {
                        String effName = wrapped ? target : (m.name != null ? m.name : "UNKNOWN");
                        if (effName.endsWith("()")) effName = effName.substring(0, effName.length() - 2);

                        Map<Integer, String> sNames = null;
                        if (m == cs.composition && cs.machines != null && cs.machines.size() > 1) {
                            sNames = buildCompositeStateNames(cs, m, allProcNames);
                        } else {
                            sNames = allProcNames.get(effName);
                            if (sNames == null) {
                                for (String pk : allProcNames.keySet()) {
                                    if (sameName(pk, effName)) {
                                        sNames = allProcNames.get(pk);
                                        break;
                                    }
                                }
                            }
                        }
                        machines.add(machineJson(m, wrapped ? target : null, sNames));
                    }
                } else if (mode.equals("check")) {
                    cs.compose(output);
                    cs.analyse(output);
                    verdict = verdictFrom(cs, log.toString());
                    trace = traceOf(cs);
                } else if (mode.equals("progress")) {
                    cs.compose(output);
                    cs.checkProgress(output);
                    verdict = log.toString().contains("No progress violations detected") ? "ok" : "violation";
                    trace = traceOf(cs);
                } else {
                    errors.add(errorJson(1, 1, "Unknown mode: " + mode));
                }
            } catch (LTSException e) {
                errors.add(errorFromException(e, content));
            } catch (Throwable e) {
                errors.add(errorJson(1, 1, String.valueOf(e)));
            }
        }

        StringBuilder sb = new StringBuilder();
        sb.append("{\n");
        sb.append("  \"errors\": [").append(join(errors)).append("],\n");
        sb.append("  \"targets\": [").append(join(targets)).append("],\n");
        sb.append("  \"verdict\": ").append(quote(verdict)).append(",\n");
        sb.append("  \"trace\": [");
        for (int i = 0; i < trace.size(); i++) {
            if (i > 0) sb.append(",");
            sb.append(quote(trace.get(i)));
        }
        sb.append("],\n");
        sb.append("  \"log\": ").append(quote(log.toString())).append(",\n");
        sb.append("  \"machines\": [").append(join(machines)).append("]\n");
        sb.append("}");
        realOut.println(sb.toString());
        realOut.flush();
    }

    // ---- result helpers ---------------------------------------------------

    private static String verdictFrom(CompositeState cs, String text) {
        Vector t = cs.getErrorTrace();
        if (t != null && t.size() > 0) return "violation";
        if (text.contains("violation") || text.contains("DEADLOCK") || text.contains("Trace to")) return "violation";
        return "ok";
    }

    private static List<String> traceOf(CompositeState cs) {
        List<String> out = new ArrayList<String>();
        Vector t = cs.getErrorTrace();
        if (t != null) {
            for (Object o : t) out.add(String.valueOf(o));
        }
        return out;
    }

    private static boolean sameName(String machineName, String target) {
        if (machineName == null) return false;
        String n = machineName.endsWith("()") ? machineName.substring(0, machineName.length() - 2) : machineName;
        return n.equals(target);
    }

    private static String machineJson(CompactState cs, String nameOverride, Map<Integer, String> stateNames) {
        String name = nameOverride != null ? nameOverride : (cs.name != null ? cs.name : "UNKNOWN");
        if (name.endsWith("()")) name = name.substring(0, name.length() - 2);
        StringBuilder sb = new StringBuilder();
        sb.append("{\"name\":").append(quote(name));
        sb.append(",\"states\":").append(cs.maxStates);
        sb.append(",\"transitions\":[");
        int count = 0;
        boolean first = true;
        boolean truncated = false;
        if (cs.states != null) {
            outer:
            for (int i = 0; i < cs.maxStates; i++) {
                EventState es = cs.states[i];
                while (es != null) {
                    if (count >= MAX_TRANSITIONS) { truncated = true; break outer; }
                    int ev = (Integer) field(es, "event", -1);
                    int next = (Integer) field(es, "next", -1);
                    String label = (cs.alphabet != null && ev >= 0 && ev < cs.alphabet.length) ? cs.alphabet[ev] : "tau";
                    if (!first) sb.append(",");
                    sb.append("{\"from\":").append(i).append(",\"to\":").append(next)
                      .append(",\"label\":").append(quote(label)).append("}");
                    first = false;
                    count++;
                    EventState nxt = (EventState) field(es, "list", null);
                    es = nxt;
                }
            }
        }
        sb.append("],\"truncated\":").append(truncated);
        sb.append(",\"stateNames\":{");
        if (stateNames != null && !stateNames.isEmpty()) {
            boolean firstSn = true;
            for (Map.Entry<Integer, String> entry : stateNames.entrySet()) {
                if (!firstSn) sb.append(",");
                sb.append(quote(String.valueOf(entry.getKey()))).append(":").append(quote(entry.getValue()));
                firstSn = false;
            }
        }
        sb.append("}}");
        return sb.toString();
    }

    private static String formatStateName(String name) {
        if (name == null) return "";
        if (name.endsWith("()")) name = name.substring(0, name.length() - 2);
        return name.replaceAll("\\.(\\d+)", "[$1]");
    }

    private static Map<Integer, String> extractProcessStateNames(Object ps, String procName) {
        Map<Integer, String> map = new HashMap<Integer, String>();
        if (ps == null) return map;
        try {
            Class smClass = Class.forName("lts.StateMachine");
            Constructor ctor = smClass.getDeclaredConstructor(Class.forName("lts.ProcessSpec"));
            ctor.setAccessible(true);
            Object sm = ctor.newInstance(ps);

            Field statesField = smClass.getDeclaredField("transitions");
            statesField.setAccessible(true);
            Vector transitions = (Vector) statesField.get(sm);

            Field counterField = smClass.getDeclaredField("stateLabel");
            counterField.setAccessible(true);
            Counter stateLabel = (Counter) counterField.get(sm);
            int max = stateLabel != null ? stateLabel.lastLabel().intValue() : 0;

            EventState[] oldStates = new EventState[max];
            Field alphaField = smClass.getDeclaredField("alphabet");
            alphaField.setAccessible(true);
            Hashtable alpha = (Hashtable) alphaField.get(sm);

            if (transitions != null && alpha != null) {
                for (Object o : transitions) {
                    Object evSym = field(o, "event", null);
                    Integer ev = (Integer) alpha.get(evSym != null ? evSym.toString() : "");
                    int tFrom = (Integer) field(o, "from", -1);
                    int tTo = (Integer) field(o, "to", -1);
                    if (ev != null && tFrom >= 0 && tFrom < max) {
                        oldStates[tFrom] = EventState.add(oldStates[tFrom], new EventState(ev, tTo));
                    }
                }
            }

            MyIntHash reachMap = (oldStates.length > 0) ? EventState.reachable(oldStates) : null;

            Field ef = smClass.getDeclaredField("explicit_states");
            ef.setAccessible(true);
            Hashtable exp = (Hashtable) ef.get(sm);
            if (exp != null) {
                for (Object k : exp.keySet()) {
                    String raw = (String) k;
                    Integer oldId = (Integer) exp.get(k);
                    if (oldId == null) continue;
                    int id = (oldId >= 0 && reachMap != null) ? reachMap.get(oldId) : oldId;
                    if (id < -1) continue; // Unreachable state

                    String formatted = formatStateName(raw);
                    String cur = map.get(id);
                    if (cur == null) {
                        map.put(id, formatted);
                    } else if (raw.equalsIgnoreCase(procName) && !cur.equalsIgnoreCase(procName)) {
                        // Keep more specific state name
                    } else if (!raw.equalsIgnoreCase(procName) && cur.equalsIgnoreCase(procName)) {
                        map.put(id, formatted);
                    }
                }
            }
        } catch (Throwable ignored) { }
        return map;
    }

    private static Map<Integer, String> buildCompositeStateNames(
            CompositeState cs, CompactState comp, Map<String, Map<Integer, String>> allProcNames) {
        Map<Integer, String> result = new HashMap<Integer, String>();
        if (cs.machines == null || comp == null || comp.maxStates <= 0) return result;

        int numMachines = cs.machines.size();
        CompactState[] machines = new CompactState[numMachines];
        Map[] machStateNames = new Map[numMachines];
        for (int i = 0; i < numMachines; i++) {
            machines[i] = (CompactState) cs.machines.get(i);
            String mName = machines[i].name != null ? machines[i].name : "";
            if (mName.endsWith("()")) mName = mName.substring(0, mName.length() - 2);
            machStateNames[i] = allProcNames.get(mName);
            if (machStateNames[i] == null) machStateNames[i] = Collections.emptyMap();
        }

        int[][] stateTuples = new int[comp.maxStates][numMachines];
        boolean[] visited = new boolean[comp.maxStates];
        Arrays.fill(stateTuples[0], 0);
        visited[0] = true;

        Queue<Integer> queue = new LinkedList<Integer>();
        queue.add(0);

        while (!queue.isEmpty()) {
            int curr = queue.poll();
            int[] currTuple = stateTuples[curr];

            if (comp.states != null && curr < comp.states.length) {
                EventState es = comp.states[curr];
                while (es != null) {
                    int next = (Integer) field(es, "next", -1);
                    int ev = (Integer) field(es, "event", -1);
                    String action = (comp.alphabet != null && ev >= 0 && ev < comp.alphabet.length)
                            ? comp.alphabet[ev] : null;

                    if (next >= 0 && next < comp.maxStates && !visited[next] && action != null) {
                        int[] nextTuple = new int[numMachines];
                        for (int m = 0; m < numMachines; m++) {
                            CompactState mach = machines[m];
                            int machCurrState = currTuple[m];
                            int machNext = getNextState(mach, machCurrState, action);
                            nextTuple[m] = (machNext != -2) ? machNext : machCurrState;
                        }
                        stateTuples[next] = nextTuple;
                        visited[next] = true;
                        queue.add(next);
                    }
                    es = (EventState) field(es, "list", null);
                }
            }
        }

        for (int s = 0; s < comp.maxStates; s++) {
            StringBuilder sb = new StringBuilder();
            sb.append("[");
            for (int m = 0; m < numMachines; m++) {
                if (m > 0) sb.append(", ");
                int subState = stateTuples[s][m];
                String subName = (String) machStateNames[m].get(subState);
                if (subName != null) {
                    sb.append(subName);
                } else {
                    sb.append(subState);
                }
            }
            sb.append("]");
            result.put(s, sb.toString());
        }

        return result;
    }

    private static int getNextState(CompactState mach, int state, String action) {
        if (state < 0 || mach.states == null || state >= mach.states.length) return -2;
        EventState es = mach.states[state];
        while (es != null) {
            int ev = (Integer) field(es, "event", -1);
            if (ev >= 0 && mach.alphabet != null && ev < mach.alphabet.length && mach.alphabet[ev].equals(action)) {
                return (Integer) field(es, "next", -1);
            }
            es = (EventState) field(es, "list", null);
        }
        return -2;
    }

    private static Object field(Object o, String name, Object dflt) {
        try {
            java.lang.reflect.Field f = o.getClass().getDeclaredField(name);
            f.setAccessible(true);
            return f.get(o);
        } catch (Throwable t) {
            return dflt;
        }
    }

    private static String targetJson(String name, String kind) {
        return "{\"name\":" + quote(name) + ",\"kind\":" + quote(kind) + "}";
    }

    private static String errorFromException(LTSException e, String content) {
        int line = 1, col = 1;
        Object marker = e.marker;
        if (marker instanceof Symbol) {
            int pos = ((Symbol) marker).startPos;
            for (int i = 0; i < pos && i < content.length(); i++) {
                if (content.charAt(i) == '\n') { line++; col = 1; } else { col++; }
            }
        }
        return errorJson(line, col, e.getMessage());
    }

    private static String errorJson(int line, int col, String msg) {
        return "{\"line\":" + line + ",\"col\":" + col + ",\"message\":" + quote(msg) + "}";
    }

    private static List sorted(Enumeration e) {
        List l = new ArrayList();
        while (e.hasMoreElements()) l.add(e.nextElement());
        Collections.sort(l);
        return l;
    }

    private static String join(List<String> parts) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < parts.size(); i++) {
            if (i > 0) sb.append(",");
            sb.append(parts.get(i));
        }
        return sb.toString();
    }

    private static String quote(String s) {
        if (s == null) return "\"\"";
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append("\"").toString();
    }

    private static String readFile(String path) throws IOException {
        StringBuilder sb = new StringBuilder();
        BufferedReader br = new BufferedReader(new InputStreamReader(new FileInputStream(path), "UTF-8"));
        try {
            String line;
            while ((line = br.readLine()) != null) sb.append(line).append("\n");
        } finally {
            br.close();
        }
        return sb.toString();
    }
}
