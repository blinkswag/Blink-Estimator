/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Calculator, 
  FileText, 
  Info, 
  AlertTriangle, 
  CheckCircle2, 
  History, 
  Layers, 
  Maximize2, 
  ChevronRight,
  Loader2,
  Upload,
  RefreshCw,
  FileSearch,
  ChevronLeft,
  Download,
  User,
  Check,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { estimatePricing, extractSignDetails, fetchPricingFromGoogleSheet } from './services/geminiService';
import { EstimationResult, SignScope, ArtworkContext, DEFAULT_SHEET_ID } from './types';
import { cn } from '@/lib/utils';

export default function App() {
  const [view, setView] = useState<'launch' | 'report'>('launch');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<EstimationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState(DEFAULT_SHEET_ID);
  const [specText, setSpecText] = useState('');
  const [uploadedFile, setUploadedFile] = useState<{ name: string; type: string; base64: string } | null>(null);
  const [projectType, setProjectType] = useState<'Government' | 'Standard'>('Standard');
  const [hasProgramPricing, setHasProgramPricing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [scope, setScope] = useState<SignScope>({
    sign_type: 'Other',
    dimensions: { height: 12, width: 12, depth: 1 },
    mounting: 'Flush',
    illumination: 'None',
    materials: 'Acrylic',
    letter_count: 0
  });

  const [artwork, setArtwork] = useState<ArtworkContext>({
    complexity_score: 5,
    stroke_thickness_flags: []
  });

  useEffect(() => {
    handleSyncSheet();
  }, []);

  useEffect(() => {
    if (projectType === 'Government') {
      setHasProgramPricing(false);
    }
  }, [projectType]);

  const handleSyncSheet = async () => {
    setSyncing(true);
    try {
      await fetchPricingFromGoogleSheet(sheetId);
      setError(null);
    } catch (err) {
      console.error('Sync failed', err);
      setError(err instanceof Error ? err.message : 'Failed to sync Google Sheet');
    } finally {
      setSyncing(false);
    }
  };

  const handleEstimate = async () => {
    setLoading(true);
    setError(null);
    setView('report'); // Switch to report view immediately to show loading state
    
    try {
      let currentScope = { ...scope };
      let currentArtwork = { ...artwork };

      let combinedNotes = specText;

      // If there's an uploaded file, extract details first
      if (uploadedFile) {
        try {
          const details = await extractSignDetails(uploadedFile.base64, uploadedFile.type);
          if (details.scope) {
            currentScope = {
              ...scope,
              ...details.scope,
              dimensions: {
                ...scope.dimensions,
                ...details.scope.dimensions
              }
            };
            setScope(currentScope);
          }
          if (details.notes) {
            combinedNotes = `${specText}\n\n[Extracted from file]: ${details.notes}`.trim();
          }
        } catch (extractErr) {
          console.error('Extraction failed, proceeding with manual inputs', extractErr);
          // We continue even if extraction fails, using manual inputs
        }
      }

      const data = await estimatePricing(currentScope, currentArtwork, combinedNotes, projectType, hasProgramPricing);
      setResult(data);
    } catch (err) {
      setError('Failed to generate estimate. Please check your inputs and try again.');
      console.error(err);
      setView('launch'); // Switch back on error
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        setUploadedFile({
          name: file.name,
          type: file.type,
          base64: base64
        });
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError('Failed to read file.');
      console.error(err);
    }
  };

  const LaunchView = () => (
    <div className="min-h-screen bg-[#0B1120] text-slate-200 flex flex-col">
      <header className="px-6 py-4 flex items-center justify-between border-b border-slate-800/50">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-1.5 rounded-md">
            <span className="text-white font-black text-xl">S</span>
          </div>
          <div>
            <h1 className="text-lg font-bold leading-none">SignCalc Pro</h1>
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-1">CHANNEL LETTER PRICING ENGINE</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-900/50 border border-slate-800 rounded-full px-3 py-1.5">
            <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-bold">A</div>
            <span className="text-xs font-semibold">Admin</span>
            <ChevronRight className="w-3 h-3 text-slate-400 rotate-90" />
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="text-center mb-12">
          <h2 className="text-5xl font-extrabold tracking-tight mb-4">Wholesale Pricing Engine</h2>
          <p className="text-slate-400 max-w-2xl mx-auto text-lg">
            Accurate fabrication cost comparisons for Sign Shops. Compare USA vs China wholesale rates.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-5xl">
          {/* Step 1: Upload */}
          <Card className="bg-[#0F172A]/50 border-slate-800 shadow-2xl blue-glow">
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <div className="w-8 h-8 rounded bg-blue-600/20 text-blue-500 flex items-center justify-center font-bold text-sm">1</div>
              <CardTitle className="text-lg font-bold text-slate-100">Upload Drawing</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {uploadedFile ? (
                <div className="border-2 border-blue-500/30 bg-blue-500/5 rounded-xl p-8 flex flex-col items-center justify-center relative group">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setUploadedFile(null);
                    }}
                    className="absolute top-3 right-3 p-1.5 rounded-full bg-slate-800 text-slate-400 hover:text-pink-500 hover:bg-pink-500/10 transition-all opacity-0 group-hover:opacity-100"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <div className="bg-blue-600/20 p-4 rounded-2xl mb-4">
                    {uploadedFile.type.startsWith('image/') ? (
                      <Layers className="w-8 h-8 text-blue-500" />
                    ) : (
                      <FileText className="w-8 h-8 text-blue-500" />
                    )}
                  </div>
                  <p className="text-sm font-bold text-slate-200 text-center truncate max-w-full px-4">
                    {uploadedFile.name}
                  </p>
                  <p className="text-[10px] font-bold text-slate-500 uppercase mt-1 tracking-widest">
                    Ready for analysis
                  </p>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="mt-4 text-[10px] font-bold uppercase tracking-widest text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Change File
                  </Button>
                </div>
              ) : (
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-700 rounded-xl p-12 flex flex-col items-center justify-center cursor-pointer hover:border-blue-500/50 hover:bg-blue-500/5 transition-all group"
                >
                  <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*,application/pdf" />
                  <div className="bg-slate-800 p-4 rounded-full mb-4 group-hover:scale-110 transition-transform">
                    <Upload className="w-6 h-6 text-slate-400" />
                  </div>
                  <p className="text-sm font-semibold text-slate-300">Click to select file</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Step 2: Specs */}
          <Card className="bg-[#0F172A]/50 border-slate-800 shadow-2xl blue-glow">
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <div className="w-8 h-8 rounded bg-blue-600/20 text-blue-500 flex items-center justify-center font-bold text-sm">2</div>
              <CardTitle className="text-lg font-bold text-slate-100">Specifications</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <textarea 
                placeholder="Paste specs: Qty, height, lighting type... Mention RACEWAY or FLUSH mount."
                value={specText}
                onChange={(e) => setSpecText(e.target.value)}
                className="w-full h-[184px] bg-slate-950/50 border border-slate-800 rounded-xl p-4 text-sm text-slate-200 focus:ring-1 focus:ring-blue-500 outline-none resize-none placeholder:text-slate-400"
              />
            </CardContent>
          </Card>
        </div>

        <div className="mt-12 space-y-8 max-w-md mx-auto">
          <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 space-y-6">
            <div className="space-y-3">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Project Type</Label>
              <div className="grid grid-cols-2 gap-3">
                <Button 
                  variant="outline" 
                  className={cn(
                    "h-12 border-slate-800 text-xs font-bold uppercase tracking-wider transition-all",
                    projectType === 'Government' ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20" : "bg-slate-950/50 text-slate-400 hover:bg-slate-800"
                  )}
                  onClick={() => setProjectType('Government')}
                >
                  Government Bid
                </Button>
                <Button 
                  variant="outline" 
                  className={cn(
                    "h-12 border-slate-800 text-xs font-bold uppercase tracking-wider transition-all",
                    projectType === 'Standard' ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20" : "bg-slate-950/50 text-slate-400 hover:bg-slate-800"
                  )}
                  onClick={() => setProjectType('Standard')}
                >
                  Standard Project
                </Button>
              </div>
            </div>

            {projectType === 'Standard' && (
              <div className="flex items-center justify-between p-4 bg-slate-950/50 rounded-xl border border-slate-800/50">
                <div className="space-y-1">
                  <Label className="text-sm font-bold text-slate-200">Program Pricing</Label>
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-tighter">Apply pre-negotiated rates</p>
                </div>
                <button 
                  onClick={() => setHasProgramPricing(!hasProgramPricing)}
                  className={cn(
                    "w-12 h-6 rounded-full transition-all relative",
                    hasProgramPricing ? "bg-blue-600 shadow-[0_0_10px_rgba(37,99,235,0.3)]" : "bg-slate-800"
                  )}
                >
                  <div className={cn(
                    "absolute top-1 w-4 h-4 rounded-full bg-white transition-all shadow-sm",
                    hasProgramPricing ? "left-7" : "left-1"
                  )} />
                </button>
              </div>
            )}
          </div>

          <Button 
            onClick={handleEstimate}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-8 rounded-2xl text-xl font-black uppercase tracking-widest shadow-xl shadow-blue-500/20 transition-all active:scale-[0.98]"
          >
            {loading ? <Loader2 className="w-8 h-8 animate-spin" /> : "Generate Wholesale Estimate"}
          </Button>
        </div>
      </main>

      <footer className="px-6 py-4 flex items-center justify-between border-t border-slate-800/50 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
        <div>© 2025 SIGN CALC PRO — WHOLESALE PRICING ENGINE</div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
          <span className="text-slate-400">WHOLESALE BENCHMARKS ACTIVE</span>
        </div>
      </footer>
    </div>
  );

  const ReportView = () => {
    if (!result || loading) return (
      <div className="min-h-screen bg-[#0B1120] text-slate-200 flex items-center justify-center">
        <div className="text-center space-y-6">
          <div className="relative">
            <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full animate-pulse" />
            <Loader2 className="w-16 h-16 text-blue-500 animate-spin mx-auto relative z-10" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold tracking-tight">Generating Fabrication Report</h3>
            <p className="text-slate-400 max-w-xs mx-auto text-sm">
              Analyzing specifications and matching against wholesale benchmarks...
            </p>
          </div>
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-slate-200" onClick={() => setView('launch')}>
            Cancel and Return
          </Button>
        </div>
      </div>
    );

    return (
      <div className="min-h-screen bg-[#0B1120] text-slate-200 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <button 
              onClick={() => setView('launch')}
              className="flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-blue-400 transition-colors"
            >
              <ChevronLeft className="w-3 h-3" />
              New Estimate
            </button>
            <h2 className="text-3xl font-black tracking-tight">Fabrication Report</h2>
          </div>
          <Button variant="outline" className="bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800">
            <Download className="w-4 h-4 mr-2" />
            Save as PDF
          </Button>
        </div>

        <div className="space-y-8">
          {/* Row 1: Cost Estimate & Scope */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8">
              {/* Cost Estimate Card */}
              <Card className="bg-[#0F172A] border-slate-800 overflow-hidden h-full">
                <div className="h-1 bg-blue-600" />
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-200">Fabrication Cost Estimate</CardTitle>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Confidence</p>
                    <p className={cn(
                      "text-xs font-bold uppercase",
                      (result.confidence?.score || 0) >= 80 ? "text-green-500" : 
                      (result.confidence?.score || 0) >= 50 ? "text-orange-500" : "text-pink-600"
                    )}>
                      {(result.confidence?.score || 0) >= 80 ? "High" : 
                       (result.confidence?.score || 0) >= 50 ? "Medium" : "Low"}
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-slate-950/50 p-4 rounded-lg border border-slate-800">
                      <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Low Range</p>
                      <p className="text-xl font-black text-slate-200">${result.estimate?.manufacture_cost?.low?.toLocaleString() || '0'}</p>
                    </div>
                    <div className="bg-blue-600/10 p-4 rounded-lg border border-blue-500/30 shadow-[0_0_15px_rgba(37,99,235,0.1)]">
                      <p className="text-[10px] font-bold text-blue-400 uppercase mb-1">Mid Estimate</p>
                      <p className="text-xl font-black text-blue-400">${result.estimate?.manufacture_cost?.mid?.toLocaleString() || '0'}</p>
                    </div>
                    <div className="bg-slate-950/50 p-4 rounded-lg border border-slate-800">
                      <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">High Range</p>
                      <p className="text-xl font-black text-slate-200">${result.estimate?.manufacture_cost?.high?.toLocaleString() || '0'}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="flex items-center justify-between p-3 bg-slate-950/30 rounded-lg border border-slate-800/50">
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pricing Source</p>
                        <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/20">
                          {result.pricing_source || 'USA'}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-950/30 rounded-lg border border-slate-800/50">
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Project Context</p>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-400 border-purple-500/20">
                            {projectType}
                          </Badge>
                          {hasProgramPricing && (
                            <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/20">
                              Program
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {result.overseas_estimate && (
                    <div className="p-3 mb-6 bg-orange-500/5 rounded-lg border border-orange-500/20 flex items-center justify-between">
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-orange-400 uppercase tracking-widest">Estimated Overseas Pricing</p>
                        <p className="text-sm font-black text-orange-400">
                          ${result.overseas_estimate?.mid?.toLocaleString() || '0'}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px] bg-orange-500/10 text-orange-400 border-orange-500/20">
                        Save ${result.overseas_estimate?.savings?.toLocaleString() || '0'}
                      </Badge>
                    </div>
                  )}

                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Confidence Rationale</p>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {result.confidence?.rationale || 'No rationale provided.'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="lg:col-span-4">
              {/* Estimate Scope Card */}
              <Card className="bg-[#0F172A] border-slate-800 h-full">
                <CardHeader className="bg-slate-900/50 border-b border-slate-800">
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-200">Estimate Scope</CardTitle>
                </CardHeader>
                <CardContent className="pt-6 space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Manufacture Included</p>
                      <div className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-green-500" />
                        <span className="text-sm font-bold">Yes</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Install Included</p>
                      <div className="flex items-center gap-2">
                        <X className="w-4 h-4 text-slate-400" />
                        <span className="text-sm font-bold text-slate-400">No</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Notes</p>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      • Summary: {result.sign_type} — estimated manufacture cost ${result.estimate?.manufacture_cost?.low?.toLocaleString() || '0'}-${result.estimate?.manufacture_cost?.high?.toLocaleString() || '0'} (most likely ${result.estimate?.manufacture_cost?.mid?.toLocaleString() || '0'}). {result.estimate_scope?.notes?.join(' ') || ''}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Row 2: Line Items Breakdown */}
          <Card className="bg-[#0F172A] border-slate-800 overflow-hidden">
            <CardHeader className="bg-slate-900/50 border-b border-slate-800">
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-200">Line Items Breakdown</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader className="bg-slate-950/30">
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-[10px] font-bold text-slate-400 uppercase">Item</TableHead>
                  <TableHead className="text-[10px] font-bold text-slate-400 uppercase">Qty</TableHead>
                  <TableHead className="text-[10px] font-bold text-slate-400 uppercase">Unit Cost</TableHead>
                  <TableHead className="text-[10px] font-bold text-slate-400 uppercase">Extended</TableHead>
                  <TableHead className="text-[10px] font-bold text-orange-400/80 uppercase">Overseas</TableHead>
                  <TableHead className="text-[10px] font-bold text-slate-400 uppercase">Basis</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.isArray(result.estimate?.line_items) && result.estimate.line_items.map((item, i) => (
                  <TableRow key={i} className="border-slate-800 hover:bg-slate-800/20">
                    <TableCell className="text-xs font-medium text-slate-300 py-4">{item.name || 'Unknown Item'}</TableCell>
                    <TableCell className="text-xs font-bold text-slate-100 py-4">{item.qty || 0}</TableCell>
                    <TableCell className="text-xs font-bold text-slate-100 py-4">${(item.unit_cost || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-xs font-bold text-blue-400 py-4">${(item.extended_cost || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-xs font-bold text-orange-400 py-4">
                      ${(result.pricing_source === 'USA' 
                        ? ((item.extended_cost || 0) * 0.6) 
                        : (item.extended_cost || 0)
                      ).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell className="text-[10px] text-slate-400 max-w-[200px] py-4 leading-tight whitespace-normal break-words">{item.basis || 'N/A'}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-slate-950/30 border-none">
                  <TableCell colSpan={3} className="text-right text-[10px] font-bold text-slate-400 uppercase py-6">Total Manufacture Cost</TableCell>
                  <TableCell className="text-xl font-black text-blue-400 py-6">${result.estimate?.manufacture_cost?.mid?.toLocaleString() || '0'}</TableCell>
                  <TableCell className="text-xl font-black text-orange-400 py-6">
                    ${(result.pricing_source === 'USA' 
                      ? ((result.estimate?.manufacture_cost?.mid || 0) * 0.6) 
                      : (result.estimate?.manufacture_cost?.mid || 0)
                    ).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </TableCell>
                  <TableCell className="py-6"></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>

          {/* Row 3: Selling Price Breakdown */}
          {(projectType === 'Government' || !hasProgramPricing) && (
            <Card className="bg-[#0F172A] border-slate-800 overflow-hidden">
              <CardHeader className="bg-green-900/20 border-b border-slate-800 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-green-400">Selling Price Breakdown</CardTitle>
                <Badge className="bg-green-600 text-white border-none text-[10px] uppercase font-black">
                  {projectType === 'Government' ? 'Gov Bid' : 'Standard'}
                </Badge>
              </CardHeader>
              <Table>
                <TableHeader className="bg-slate-950/30">
                  <TableRow className="border-slate-800 hover:bg-transparent">
                    <TableHead className="text-[10px] font-bold text-slate-400 uppercase">Item</TableHead>
                    <TableHead className="text-[10px] font-bold text-slate-400 uppercase">Qty</TableHead>
                    <TableHead className="text-[10px] font-bold text-slate-400 uppercase">Unit Price</TableHead>
                    <TableHead className="text-[10px] font-bold text-green-400 uppercase">Extended Sell</TableHead>
                    <TableHead className="text-[10px] font-bold text-slate-400 uppercase">Margin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.selling_price && Array.isArray(result.selling_price.line_items) ? (
                    result.selling_price.line_items.map((item, i) => {
                      const manufactureItem = result.estimate?.line_items?.[i];
                      const marginValue = manufactureItem && item.unit_price > 0 
                        ? ((item.unit_price / manufactureItem.unit_cost) - 1) * 100
                        : (result.pricing_source === 'Overseas' ? 50 : (projectType === 'Government' ? 0 : 30));

                      return (
                        <TableRow key={i} className="border-slate-800 hover:bg-slate-800/20">
                          <TableCell className="text-xs font-medium text-slate-300 py-4">{item.name || 'Unknown Item'}</TableCell>
                          <TableCell className="text-xs font-bold text-slate-100 py-4">{item.qty || 0}</TableCell>
                          <TableCell className="text-xs font-bold text-slate-100 py-4">${item.unit_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                          <TableCell className="text-xs font-bold text-green-400 py-4">${item.extended_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                          <TableCell className="text-[10px] text-slate-500 py-4 font-bold">{Math.round(marginValue)}%</TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    Array.isArray(result.estimate?.line_items) && result.estimate.line_items.map((item, i) => {
                      let margin = 0;
                      const isOS = result.pricing_source === 'Overseas';
                      if (projectType === 'Government') margin = isOS ? 0.5 : 0;
                      else margin = isOS ? 0.5 : 0.3;

                      const unitPrice = (item.unit_cost || 0) * (1 + margin);
                      const extendedPrice = unitPrice * (item.qty || 0);

                      return (
                        <TableRow key={i} className="border-slate-800 hover:bg-slate-800/20">
                          <TableCell className="text-xs font-medium text-slate-300 py-4">{item.name || 'Unknown Item'}</TableCell>
                          <TableCell className="text-xs font-bold text-slate-100 py-4">{item.qty || 0}</TableCell>
                          <TableCell className="text-xs font-bold text-slate-100 py-4">${unitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                          <TableCell className="text-xs font-bold text-green-400 py-4">${extendedPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                          <TableCell className="text-[10px] text-slate-500 py-4 font-bold">{(margin * 100).toFixed(0)}%</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                  <TableRow className="bg-green-950/10 border-none">
                    <TableCell colSpan={3} className="text-right text-[10px] font-bold text-slate-400 uppercase py-6">Total Selling Price</TableCell>
                    <TableCell colSpan={2} className="text-xl font-black text-green-400 py-6">
                      ${(result.selling_price?.mid || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Card>
          )}

          {/* Row 4: Normalized Inputs & Matched Records */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Normalized Inputs */}
            <Card className="bg-[#0F172A] border-slate-800">
              <CardHeader className="bg-slate-900/50 border-b border-slate-800">
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-200">Normalized Inputs</CardTitle>
              </CardHeader>
              <div className="p-0">
                <Table>
                  <TableHeader className="bg-slate-950/30">
                    <TableRow className="border-slate-800 hover:bg-transparent">
                      <TableHead className="text-[10px] font-bold text-slate-400 uppercase">Parameter</TableHead>
                      <TableHead className="text-[10px] font-bold text-slate-400 uppercase">Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      { label: 'sign type', value: result.normalized_inputs?.sign_type || result.sign_type || 'N/A', color: 'text-blue-400' },
                      { label: 'copy (text)', value: result.normalized_inputs?.copy || 'N/A', color: 'text-blue-400' },
                      { label: 'letter count', value: result.normalized_inputs?.letter_count || 'N/A', color: 'text-green-500' },
                      { label: 'qty sets', value: result.normalized_inputs?.qty_sets || 1, color: 'text-slate-400' },
                      { label: 'Dimensions', isHeader: true },
                      { label: 'width ft', value: result.normalized_inputs?.dimensions?.width_ft || '0', color: 'text-green-500' },
                      { label: 'height ft', value: result.normalized_inputs?.dimensions?.height_ft || '0', color: 'text-green-500' },
                      { label: 'area sqft', value: result.normalized_inputs?.dimensions?.area_sqft || '0', color: 'text-green-500' },
                      { label: 'depth in', value: result.normalized_inputs?.depth_in || 5, color: 'text-green-500' },
                      { label: 'mounting', value: result.normalized_inputs?.mounting || 'N/A', color: 'text-green-500' },
                      { label: 'illumination', value: result.normalized_inputs?.illumination || 'N/A', color: 'text-green-500' },
                    ].map((row, i) => (
                      <TableRow key={i} className={cn("border-slate-800/50 hover:bg-slate-800/20", row.isHeader && "bg-slate-950/20")}>
                        <TableCell className={cn("text-[10px] font-bold uppercase py-2", row.isHeader ? "text-slate-200" : "text-slate-400")}>
                          {row.label}
                        </TableCell>
                        <TableCell className={cn("text-xs font-bold py-2", row.color)}>
                          {row.value}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>

            {/* Matched Records */}
            <Card className="bg-[#0F172A] border-slate-800">
              <CardHeader className="bg-slate-900/50 border-b border-slate-800 flex flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-200">Matched Records</CardTitle>
                </div>
                <Badge variant="outline" className="text-[10px] border-slate-700 text-slate-400">{result.matched_records?.length || 0} records</Badge>
              </CardHeader>
              <div className="divide-y divide-slate-800">
                {Array.isArray(result.matched_records) && result.matched_records.map((lineage, i) => (
                  <div key={i} className="p-4 space-y-3 hover:bg-slate-800/20 transition-colors">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ID / PO Number</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cost</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-slate-200">
                        {lineage.record_id} {lineage.po_number ? ` / ${lineage.po_number}` : ''}
                        {lineage.vendor_location && (
                          <span className="ml-2 text-[10px] text-slate-400 font-normal italic">
                            ({lineage.vendor_location})
                          </span>
                        )}
                      </p>
                      <p className="text-sm font-black text-green-500">${lineage.cost?.amount?.toLocaleString() || '0'}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Key Fields</p>
                      <p className="text-[10px] text-slate-300 leading-tight">
                        {lineage.key_fields?.sign_type} | {lineage.key_fields?.mounting} | {lineage.key_fields?.dimensions}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Why Match</p>
                      <p className="text-[10px] text-slate-300 leading-relaxed">{lineage.why_match}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Row 5: Assumptions */}
          <Card className="bg-[#0F172A] border-slate-800">
            <CardHeader className="flex flex-row items-center gap-2 pb-2">
              <div className="w-2 h-2 rounded-full bg-orange-500" />
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-200">Assumptions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-2">
              {Array.isArray(result.assumptions) && result.assumptions.map((text, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-4 h-4 rounded-full bg-orange-500/20 text-orange-500 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">{i+1}</div>
                  <p className="text-xs text-slate-300 leading-relaxed">{text}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Row 6: Missing Inputs & Flags */}
          <Card className="bg-[#0F172A] border-slate-800 border-l-4 border-l-pink-600">
            <CardHeader className="flex flex-row items-center gap-2 pb-2">
              <div className="w-2 h-2 rounded-full bg-pink-600" />
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-200">Missing Inputs & Flags</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-pink-600 uppercase tracking-widest">Confirm These Details</p>
                <ul className="space-y-1">
                  {Array.isArray(result.missing_inputs) && result.missing_inputs.map((input, i) => (
                    <li key={i} className="text-xs text-slate-300 flex items-center gap-2">
                      <div className="w-1 h-1 rounded-full bg-slate-500" />
                      {input}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-pink-600 uppercase tracking-widest">Alert Flags</p>
                <div className="flex gap-2">
                  {Array.isArray(result.flags) && result.flags.map((flag, i) => (
                    <Badge key={i} className="bg-slate-900 border-slate-800 text-slate-300 text-[10px] font-bold uppercase px-2 py-0.5">
                      {flag}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

  return (
    <AnimatePresence mode="wait">
      {view === 'launch' ? (
        <motion.div key="launch" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <LaunchView />
        </motion.div>
      ) : (
        <motion.div key="report" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <ReportView />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
