$transcripts = Get-ChildItem "C:\Users\Administrator\.claude\projects\D--Dicho-app" -Filter "*.jsonl" | Where-Object { $_.DirectoryName -notlike "*subagents*" } | Sort-Object LastWriteTime -Descending | Select-Object -First 20

# Also scan other projects for cross-project patterns
$otherProjects = @(
    "C:\Users\Administrator\.claude\projects\C--Users-Administrator",
    "C:\Users\Administrator\.claude\projects\D--reoncenter",
    "C:\Users\Administrator\.claude\projects\D--camera-tablet",
    "C:\Users\Administrator\.claude\projects\D--HF",
    "C:\Users\Administrator\.claude\projects\D--stitch-smart-meal-planner-groceries"
)
foreach ($dir in $otherProjects) {
    $more = Get-ChildItem $dir -Filter "*.jsonl" | Where-Object { $_.DirectoryName -notlike "*subagents*" } | Sort-Object LastWriteTime -Descending | Select-Object -First 5
    $transcripts += $more
}

$transcripts | ForEach-Object {
    Get-Content $_.FullName
} | node -e "
let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
    const lines = input.split('\n').filter(l => l.trim());
    const bashCounts = {};
    const mcpCounts = {};

    for (const line of lines) {
        try {
            const obj = JSON.parse(line);
            if (obj.type !== 'assistant') continue;
            const content = obj.message?.content || [];
            for (const item of content) {
                if (item.type === 'tool_use' && item.name === 'Bash') {
                    const cmd = item.input?.command || '';
                    if (!cmd.trim()) continue;
                    let clean = cmd.replace(/^sudo\s+/, '').replace(/^timeout\s+\d+\s+/, '');
                    let tokens = clean.split(/\s+/).filter(t => t && t !== '|' && t !== '&&' && t !== '||');
                    if (tokens.length === 0) continue;
                    let startIdx = 0;
                    while (startIdx < tokens.length && tokens[startIdx].includes('=') && !tokens[startIdx].startsWith('-')) startIdx++;
                    if (startIdx >= tokens.length) continue;
                    const mainCmd = tokens[startIdx];
                    const subCmd = tokens[startIdx + 1] || '';
                    let key = mainCmd;
                    if (subCmd && !subCmd.startsWith('-')) key = mainCmd + ' ' + subCmd;
                    if (!bashCounts[key]) bashCounts[key] = { count: 0 };
                    bashCounts[key].count++;
                } else if (item.type === 'tool_use' && item.name.startsWith('mcp__')) {
                    if (!mcpCounts[item.name]) mcpCounts[item.name] = { count: 0 };
                    mcpCounts[item.name].count++;
                }
            }
        } catch(e) {}
    }
    console.log(JSON.stringify({ bash: bashCounts, mcp: mcpCounts }));
);
" 2>&1