// -- Quote result export --
import { currentResults, MATERIAL_OPTIONS, escapeHtml } from './state.js';

function cleanPrinter(name) {
    return (name || '').replace(/_\d{2}$/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w+/g, w => {
            if (/^[A-Za-z]{1,2}\d+[A-Za-z]*$/.test(w)) return w.toUpperCase();
            return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        });
}

function buildExportRows() {
    return currentResults.map(item => {
        const brand = (MATERIAL_OPTIONS.find(m => m.name === item.material) || {}).brand || '';
        const printer = cleanPrinter(item._printer_model || '');
        const bd = item.cost_breakdown || {};
        const gcode = bd.gcode_summary || {};
        const cp = gcode.core_params || {};
        return [
            item.filename, brand, printer, item.material || '', item.color || '',
            item.quantity || 1, cp.layer_height || '', cp.fill_density || '',
            item.volume_cm3 || '', item.weight_g || '', item.estimated_time_h || '',
            item.unit_cost_cny || '', item.cost_cny || '',
            item.status === 'success' ? '成功' : (item.error || '失败'),
        ];
    });
}

const EXPORT_HEADERS = ['文件名', '材料品牌', '打印机', '材料', '颜色', '数量', '层高(mm)', '填充率(%)', '体积(cm³)', '重量(g)', '打印时间(h)', '单价(CNY)', '总价(CNY)', '状态'];

export function exportCSV() {
    if (!currentResults.length) return;
    const rows = buildExportRows();
    const csvContent = [EXPORT_HEADERS, ...rows].map(row =>
        row.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(',')
    ).join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `报价结果_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

export function exportExcel() {
    if (!currentResults.length) return;
    const rows = buildExportRows();
    const colorColIdx = 4;
    const styles = {};
    let styleCounter = 0;
    rows.forEach(row => {
        const hex = String(row[colorColIdx] || '').trim();
        if (hex && /^#?[0-9a-fA-F]{6}$/.test(hex)) {
            const clean = hex.startsWith('#') ? hex : '#' + hex;
            if (!styles[clean]) styles[clean] = 'color' + (++styleCounter);
        }
    });

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<?mso-application progid="Excel.Sheet"?>\n';
    xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n';
    xml += ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n';
    xml += '<Styles>\n';
    xml += '<Style ss:ID="header"><Font ss:Bold="1" ss:Size="11" ss:Color="#ffffff"/><Interior ss:Color="#1e293b" ss:Pattern="Solid"/></Style>\n';
    Object.entries(styles).forEach(([hex, sid]) => {
        const color = hex.replace('#', '').toUpperCase();
        xml += `<Style ss:ID="${sid}"><Interior ss:Color="#${color}" ss:Pattern="Solid"/><Font ss:Size="9"/></Style>\n`;
    });
    xml += '</Styles>\n';
    xml += '<Worksheet ss:Name="报价结果"><Table>\n';
    xml += '<Row>';
    EXPORT_HEADERS.forEach(header => { xml += `<Cell ss:StyleID="header"><Data ss:Type="String">${header}</Data></Cell>`; });
    xml += '</Row>\n';
    rows.forEach(row => {
        xml += '<Row>';
        row.forEach((cell, index) => {
            const value = String(cell);
            const type = (typeof cell === 'number' || (/^[\d.]+$/.test(value) && value !== '')) ? 'Number' : 'String';
            if (index === colorColIdx) {
                const rawHex = value.trim();
                const clean = rawHex.startsWith('#') ? rawHex : (rawHex ? '#' + rawHex : '');
                const styleId = styles[clean];
                if (styleId) {
                    xml += `<Cell ss:StyleID="${styleId}"><Data ss:Type="String">${escapeHtml(value)}</Data></Cell>`;
                    return;
                }
            }
            xml += `<Cell><Data ss:Type="${type}">${escapeHtml(value)}</Data></Cell>`;
        });
        xml += '</Row>\n';
    });
    xml += '</Table></Worksheet></Workbook>';

    const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `报价结果_${new Date().toISOString().slice(0, 10)}.xls`;
    link.click();
    URL.revokeObjectURL(url);
}
