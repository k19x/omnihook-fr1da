/**
 * Lógica de Interface do Usuário (UI)
 * Contém: Acordeão, Ordenação de Tabelas e Interações visuais simples.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Lógica do Acordeão (Menu Lateral Esquerdo)
    const accordionItems = document.querySelectorAll('.accordion-item');

    accordionItems.forEach(item => {
        const header = item.querySelector('.accordion-header');
        const content = item.querySelector('.accordion-content');
        const chevron = header.querySelector('.fa-chevron-down');

        header.addEventListener('click', () => {
            const isExpanded = header.getAttribute('aria-expanded') === 'true';

            header.setAttribute('aria-expanded', !isExpanded);
            content.classList.toggle('hidden');
            content.classList.toggle('block');

            // Gira o ícone de seta (chevron)
            chevron.classList.toggle('rotate-180');
        });
    });

    // Função de ordenação da tabela de arquivos (Explorador)
    window.ui_sortTable = (colIndex, type) => {
        const tbody = document.getElementById('file-explorer-body');
        if (!tbody) return;

        const rows = Array.from(tbody.querySelectorAll('tr'));
        if (rows.length === 0) return;

        // Gerencia estado de ordenação (asc/desc)
        if (!tbody.dataset.sortDir) tbody.dataset.sortDir = 'asc';
        if (tbody.dataset.sortCol === String(colIndex)) {
            tbody.dataset.sortDir = tbody.dataset.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            tbody.dataset.sortDir = 'asc';
            tbody.dataset.sortCol = colIndex;
        }
        const isAsc = tbody.dataset.sortDir === 'asc';

        // Atualiza ícones visualmente
        document.querySelectorAll('#explorer-panel th i.fa-sort, #explorer-panel th i.fa-sort-up, #explorer-panel th i.fa-sort-down').forEach(icon => {
            icon.className = 'fa-solid fa-sort ml-1 opacity-30 group-hover:opacity-100 transition-opacity';
        });
        const activeTh = document.querySelectorAll('#explorer-panel th')[colIndex];
        if (activeTh) {
            const icon = activeTh.querySelector('i');
            if (icon) icon.className = `fa-solid fa-sort-${isAsc ? 'up' : 'down'} ml-1 text-brand`;
        }

        // Lógica de comparação
        rows.sort((rowA, rowB) => {
            const cellA = rowA.children[colIndex]?.innerText.trim() || '';
            const cellB = rowB.children[colIndex]?.innerText.trim() || '';
            return isAsc ? cellA.localeCompare(cellB, undefined, {numeric: true}) : cellB.localeCompare(cellA, undefined, {numeric: true});
        });

        rows.forEach(row => tbody.appendChild(row));
    };
});